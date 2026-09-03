#!/usr/bin/env python3
"""Static analyzer for Windows PE files, with extra depth for .NET assemblies.

Reports, without executing the sample:
  * PE headers, sections (with Shannon entropy), data directories
  * Native import / export tables
  * Version resource (CompanyName, ProductName, FileVersion, ...)
  * Authenticode signature: presence, certificate chain subjects and validity
  * CLI metadata: streams, AssemblyRef, ModuleRef, ManifestResource
  * P/Invoke map (ImplMap) -- the .NET equivalent of a native import table
  * Referenced type namespaces (TypeRef), grouped
  * Network indicators: URLs, bare hostnames, UNC paths, registry keys

Pure stdlib. Usage:
    python3 tools/pe_dotnet_analyzer.py <file.exe> [--json report.json] [--max N]
"""

from __future__ import annotations

import argparse
import binascii
import hashlib
import json
import math
import re
import struct
import sys
from collections import Counter, OrderedDict

# --------------------------------------------------------------------------
# small binary helpers
# --------------------------------------------------------------------------


def u8(b, o):
    return b[o]


def u16(b, o):
    return struct.unpack_from("<H", b, o)[0]


def u32(b, o):
    return struct.unpack_from("<I", b, o)[0]


def u64(b, o):
    return struct.unpack_from("<Q", b, o)[0]


def cstr(b, o, limit=512):
    end = b.find(b"\x00", o, o + limit)
    if end < 0:
        end = o + limit
    return b[o:end].decode("utf-8", "replace")


def entropy(data: bytes) -> float:
    if not data:
        return 0.0
    counts = Counter(data)
    n = len(data)
    return -sum((c / n) * math.log2(c / n) for c in counts.values())


# --------------------------------------------------------------------------
# PE layer
# --------------------------------------------------------------------------

MACHINES = {0x014C: "i386", 0x8664: "amd64", 0x01C0: "arm", 0xAA64: "arm64"}
SUBSYSTEMS = {1: "native", 2: "windows_gui", 3: "windows_cui", 9: "windows_ce_gui"}
DIR_NAMES = [
    "export", "import", "resource", "exception", "security", "basereloc",
    "debug", "architecture", "globalptr", "tls", "load_config", "bound_import",
    "iat", "delay_import", "com_descriptor", "reserved",
]
SECTION_FLAGS = OrderedDict([
    (0x00000020, "CODE"), (0x00000040, "IDATA"), (0x00000080, "UDATA"),
    (0x02000000, "DISCARDABLE"), (0x20000000, "EXEC"), (0x40000000, "READ"),
    (0x80000000, "WRITE"),
])


class PE:
    def __init__(self, data: bytes):
        self.data = data
        if data[:2] != b"MZ":
            raise ValueError("not an MZ/PE image")
        self.pe_off = u32(data, 0x3C)
        if data[self.pe_off:self.pe_off + 4] != b"PE\0\0":
            raise ValueError("missing PE signature")
        coff = self.pe_off + 4
        self.machine = u16(data, coff)
        self.num_sections = u16(data, coff + 2)
        self.timestamp = u32(data, coff + 4)
        self.opt_size = u16(data, coff + 16)
        self.characteristics = u16(data, coff + 18)

        opt = coff + 20
        self.magic = u16(data, opt)
        self.plus = self.magic == 0x20B
        self.entry_rva = u32(data, opt + 16)
        self.image_base = u64(data, opt + 24) if self.plus else u32(data, opt + 28)
        self.subsystem = u16(data, opt + 68)
        self.dll_characteristics = u16(data, opt + 70)
        dd_count_off = opt + (108 if self.plus else 92)
        self.num_dirs = u32(data, dd_count_off)
        dd = dd_count_off + 4
        self.dirs = [
            (u32(data, dd + i * 8), u32(data, dd + i * 8 + 4))
            for i in range(min(self.num_dirs, 16))
        ]

        sec = opt + self.opt_size
        self.sections = []
        for i in range(self.num_sections):
            o = sec + i * 40
            self.sections.append({
                "name": cstr(data, o, 8),
                "vsize": u32(data, o + 8),
                "vaddr": u32(data, o + 12),
                "rawsize": u32(data, o + 16),
                "rawptr": u32(data, o + 20),
                "flags": u32(data, o + 36),
            })

    # -- address translation -------------------------------------------------
    def rva_to_off(self, rva: int):
        for s in self.sections:
            if s["vaddr"] <= rva < s["vaddr"] + max(s["vsize"], s["rawsize"]):
                delta = rva - s["vaddr"]
                if delta < s["rawsize"]:
                    return s["rawptr"] + delta
                return None
        return None

    def read_rva(self, rva: int, size: int):
        o = self.rva_to_off(rva)
        if o is None:
            return b""
        return self.data[o:o + size]

    def dir_entry(self, name: str):
        idx = DIR_NAMES.index(name)
        return self.dirs[idx] if idx < len(self.dirs) else (0, 0)

    # -- imports -------------------------------------------------------------
    def imports(self):
        rva, size = self.dir_entry("import")
        out = OrderedDict()
        if not rva:
            return out
        off = self.rva_to_off(rva)
        if off is None:
            return out
        i = 0
        while True:
            desc = self.data[off + i * 20: off + (i + 1) * 20]
            if len(desc) < 20 or desc == b"\0" * 20:
                break
            oft, _, _, name_rva, first_thunk = struct.unpack("<IIIII", desc)
            dll = cstr(self.data, self.rva_to_off(name_rva) or 0, 128)
            thunk_rva = oft or first_thunk
            funcs = []
            t = self.rva_to_off(thunk_rva)
            if t is not None:
                step = 8 if self.plus else 4
                ordinal_flag = (1 << 63) if self.plus else (1 << 31)
                j = 0
                while j < 4096:
                    val = u64(self.data, t + j * step) if self.plus else u32(self.data, t + j * step)
                    if val == 0:
                        break
                    if val & ordinal_flag:
                        funcs.append(f"#{val & 0xFFFF}")
                    else:
                        ho = self.rva_to_off(val & 0x7FFFFFFF)
                        funcs.append(cstr(self.data, ho + 2, 128) if ho else "?")
                    j += 1
            out[dll] = funcs
            i += 1
        return out

    def exports(self):
        rva, size = self.dir_entry("export")
        if not rva:
            return []
        off = self.rva_to_off(rva)
        if off is None:
            return []
        count = u32(self.data, off + 24)
        names_rva = u32(self.data, off + 32)
        no = self.rva_to_off(names_rva)
        if no is None:
            return []
        names = []
        for i in range(min(count, 4096)):
            nrva = u32(self.data, no + i * 4)
            so = self.rva_to_off(nrva)
            if so:
                names.append(cstr(self.data, so, 256))
        return names

    # -- version resource ----------------------------------------------------
    def version_info(self):
        """Locate VS_FIXEDFILEINFO + StringFileInfo by signature scan."""
        info = OrderedDict()
        sig = b"V\x00S\x00_\x00V\x00E\x00R\x00S\x00I\x00O\x00N\x00_\x00I\x00N\x00F\x00O\x00"
        pos = self.data.find(sig)
        if pos < 0:
            return info
        ffi = self.data.find(b"\xbd\x04\xef\xfe", pos, pos + 0x200)
        if ffi > 0:
            ms_f, ls_f, ms_p, ls_p = struct.unpack_from("<IIII", self.data, ffi + 8)
            info["FileVersion(fixed)"] = "%d.%d.%d.%d" % (
                ms_f >> 16, ms_f & 0xFFFF, ls_f >> 16, ls_f & 0xFFFF)
            info["ProductVersion(fixed)"] = "%d.%d.%d.%d" % (
                ms_p >> 16, ms_p & 0xFFFF, ls_p >> 16, ls_p & 0xFFFF)
        blob = self.data[pos:pos + 0x2000]
        keys = ["CompanyName", "FileDescription", "FileVersion", "InternalName",
                "LegalCopyright", "OriginalFilename", "ProductName", "ProductVersion"]
        for k in keys:
            kb = k.encode("utf-16-le")
            i = blob.find(kb)
            if i < 0:
                continue
            j = i + len(kb)
            while j + 1 < len(blob) and blob[j:j + 2] == b"\x00\x00":
                j += 2
            end = blob.find(b"\x00\x00", j)
            if end < 0:
                continue
            if (end - j) % 2:
                end += 1
            val = blob[j:end].decode("utf-16-le", "replace").strip()
            if val:
                info[k] = val
        return info

    # -- authenticode --------------------------------------------------------
    def authenticode(self):
        rva, size = self.dir_entry("security")
        res = {"signed": bool(size), "blob_offset": rva, "blob_size": size,
               "certificates": []}
        if not size:
            return res
        blob = self.data[rva:rva + size]
        res["blob_sha256"] = hashlib.sha256(blob).hexdigest()
        for cert in _asn1_find_certificates(blob):
            parsed = _parse_certificate(cert)
            if parsed:
                res["certificates"].append(parsed)
        return res


# --------------------------------------------------------------------------
# minimal ASN.1 / X.509 (enough for chain subjects + validity)
# --------------------------------------------------------------------------

OIDS = {
    "2.5.4.3": "CN", "2.5.4.6": "C", "2.5.4.7": "L", "2.5.4.8": "ST",
    "2.5.4.10": "O", "2.5.4.11": "OU",
}


def _asn1_read_tlv(b, o):
    """Return (tag, header_len, length, next_offset) or None."""
    if o + 2 > len(b):
        return None
    tag = b[o]
    ln = b[o + 1]
    hl = 2
    if ln & 0x80:
        n = ln & 0x7F
        if n == 0 or n > 4 or o + 2 + n > len(b):
            return None
        ln = int.from_bytes(b[o + 2:o + 2 + n], "big")
        hl = 2 + n
    if o + hl + ln > len(b):
        return None
    return tag, hl, ln, o + hl + ln


def _asn1_find_certificates(blob):
    """Scan for X.509 Certificate SEQUENCEs (SEQ{SEQ{[0]|INT ...}, SEQ, BITSTRING})."""
    certs, i = [], 0
    while i < len(blob) - 4:
        if blob[i] != 0x30:
            i += 1
            continue
        t = _asn1_read_tlv(blob, i)
        if not t or t[2] < 200 or t[2] > 8192:
            i += 1
            continue
        body = i + t[1]
        inner = _asn1_read_tlv(blob, body)
        if inner and inner[0] == 0x30:
            tbs = blob[i:t[3]]
            # a certificate's tbs starts with [0] EXPLICIT version or serial INTEGER
            nxt = _asn1_read_tlv(blob, body + inner[1])
            if nxt and nxt[0] in (0xA0, 0x02):
                certs.append(tbs)
                i = t[3]
                continue
        i += 1
    return certs


def _asn1_oid(b):
    if not b:
        return ""
    out = [str(b[0] // 40), str(b[0] % 40)]
    val = 0
    for byte in b[1:]:
        val = (val << 7) | (byte & 0x7F)
        if not byte & 0x80:
            out.append(str(val))
            val = 0
    return ".".join(out)


def _parse_name(b, o, end):
    """RDNSequence -> 'C=US, O=..., CN=...'"""
    parts = []
    i = o
    while i < end:
        t = _asn1_read_tlv(b, i)
        if not t:
            break
        if t[0] == 0x31:  # SET
            j = i + t[1]
            inner_end = t[3]
            while j < inner_end:
                s = _asn1_read_tlv(b, j)
                if not s or s[0] != 0x30:
                    break
                k = j + s[1]
                oid_t = _asn1_read_tlv(b, k)
                if not oid_t:
                    break
                oid = _asn1_oid(b[k + oid_t[1]:oid_t[3]])
                val_t = _asn1_read_tlv(b, oid_t[3])
                if val_t:
                    raw = b[oid_t[3] + val_t[1]:val_t[3]]
                    txt = raw.decode("utf-16-be" if val_t[0] == 0x1E else "utf-8", "replace")
                    parts.append(f"{OIDS.get(oid, oid)}={txt}")
                j = s[3]
        i = t[3]
    return ", ".join(parts)


def _parse_time(b, o):
    t = _asn1_read_tlv(b, o)
    if not t or t[0] not in (0x17, 0x18):
        return None
    s = b[o + t[1]:t[3]].decode("ascii", "replace").rstrip("Z")
    if t[0] == 0x17:  # UTCTime YYMMDDHHMMSS
        yy = int(s[:2])
        s = ("19" if yy >= 50 else "20") + s
    return f"{s[0:4]}-{s[4:6]}-{s[6:8]}T{s[8:10]}:{s[10:12]}:{s[12:14]}Z"


def _parse_certificate(cert):
    t = _asn1_read_tlv(cert, 0)
    if not t:
        return None
    tbs = _asn1_read_tlv(cert, t[1])
    if not tbs or tbs[0] != 0x30:
        return None
    i = tbs[0 + 1] + t[1] if False else t[1] + tbs[1]
    end = tbs[3]
    fields = []
    while i < end and len(fields) < 8:
        f = _asn1_read_tlv(cert, i)
        if not f:
            break
        fields.append((f[0], i, f[1], f[3]))
        i = f[3]
    out = {"sha1": hashlib.sha1(cert).hexdigest()}
    idx = 0
    if fields and fields[0][0] == 0xA0:  # version
        idx = 1
    try:
        serial = cert[fields[idx][1] + fields[idx][2]:fields[idx][3]]
        out["serial"] = binascii.hexlify(serial).decode()
        sig_alg = fields[idx + 1]
        issuer = fields[idx + 2]
        validity = fields[idx + 3]
        subject = fields[idx + 4]
        out["issuer"] = _parse_name(cert, issuer[1] + issuer[2], issuer[3])
        out["subject"] = _parse_name(cert, subject[1] + subject[2], subject[3])
        vstart = validity[1] + validity[2]
        nb = _parse_time(cert, vstart)
        nb_t = _asn1_read_tlv(cert, vstart)
        na = _parse_time(cert, nb_t[3]) if nb_t else None
        out["not_before"], out["not_after"] = nb, na
    except (IndexError, TypeError):
        pass
    return out if out.get("subject") else None


# --------------------------------------------------------------------------
# CLI / .NET metadata
# --------------------------------------------------------------------------

CODED = {
    "TypeDefOrRef": ([2, 1, 27], 2),
    "HasConstant": ([4, 8, 23], 2),
    "HasCustomAttribute": ([6, 4, 1, 2, 8, 10, 17, 0, 14, 23, 20, 24, 26, 27,
                            32, 35, 38, 39, 40, 42, 43, 44], 5),
    "HasFieldMarshal": ([4, 8], 1),
    "HasDeclSecurity": ([2, 6, 32], 2),
    "MemberRefParent": ([2, 1, 26, 6, 27], 3),
    "HasSemantics": ([20, 23], 1),
    "MethodDefOrRef": ([6, 10], 1),
    "MemberForwarded": ([4, 6], 1),
    "Implementation": ([38, 39, 35], 2),
    "CustomAttributeType": ([-1, -1, 6, 10, -1], 3),
    "ResolutionScope": ([0, 26, 35, 1], 2),
    "TypeOrMethodDef": ([2, 6], 1),
}

TABLES = {
    0:  ("Module", ["u2", "str", "guid", "guid", "guid"]),
    1:  ("TypeRef", ["ci:ResolutionScope", "str", "str"]),
    2:  ("TypeDef", ["u4", "str", "str", "ci:TypeDefOrRef", "rid:4", "rid:6"]),
    3:  ("FieldPtr", ["rid:4"]),
    4:  ("Field", ["u2", "str", "blob"]),
    5:  ("MethodPtr", ["rid:6"]),
    6:  ("MethodDef", ["u4", "u2", "u2", "str", "blob", "rid:8"]),
    7:  ("ParamPtr", ["rid:8"]),
    8:  ("Param", ["u2", "u2", "str"]),
    9:  ("InterfaceImpl", ["rid:2", "ci:TypeDefOrRef"]),
    10: ("MemberRef", ["ci:MemberRefParent", "str", "blob"]),
    11: ("Constant", ["u2", "ci:HasConstant", "blob"]),
    12: ("CustomAttribute", ["ci:HasCustomAttribute", "ci:CustomAttributeType", "blob"]),
    13: ("FieldMarshal", ["ci:HasFieldMarshal", "blob"]),
    14: ("DeclSecurity", ["u2", "ci:HasDeclSecurity", "blob"]),
    15: ("ClassLayout", ["u2", "u4", "rid:2"]),
    16: ("FieldLayout", ["u4", "rid:4"]),
    17: ("StandAloneSig", ["blob"]),
    18: ("EventMap", ["rid:2", "rid:20"]),
    19: ("EventPtr", ["rid:20"]),
    20: ("Event", ["u2", "str", "ci:TypeDefOrRef"]),
    21: ("PropertyMap", ["rid:2", "rid:23"]),
    22: ("PropertyPtr", ["rid:23"]),
    23: ("Property", ["u2", "str", "blob"]),
    24: ("MethodSemantics", ["u2", "rid:6", "ci:HasSemantics"]),
    25: ("MethodImpl", ["rid:2", "ci:MethodDefOrRef", "ci:MethodDefOrRef"]),
    26: ("ModuleRef", ["str"]),
    27: ("TypeSpec", ["blob"]),
    28: ("ImplMap", ["u2", "ci:MemberForwarded", "str", "rid:26"]),
    29: ("FieldRVA", ["u4", "rid:4"]),
    30: ("ENCLog", ["u4", "u4"]),
    31: ("ENCMap", ["u4"]),
    32: ("Assembly", ["u4", "u2", "u2", "u2", "u2", "u4", "blob", "str", "str"]),
    33: ("AssemblyProcessor", ["u4"]),
    34: ("AssemblyOS", ["u4", "u4", "u4"]),
    35: ("AssemblyRef", ["u2", "u2", "u2", "u2", "u4", "blob", "str", "str", "blob"]),
    36: ("AssemblyRefProcessor", ["u4", "rid:35"]),
    37: ("AssemblyRefOS", ["u4", "u4", "u4", "rid:35"]),
    38: ("File", ["u4", "str", "blob"]),
    39: ("ExportedType", ["u4", "u4", "str", "str", "ci:Implementation"]),
    40: ("ManifestResource", ["u4", "u4", "str", "ci:Implementation"]),
    41: ("NestedClass", ["rid:2", "rid:2"]),
    42: ("GenericParam", ["u2", "u2", "ci:TypeOrMethodDef", "str"]),
    43: ("MethodSpec", ["ci:MethodDefOrRef", "blob"]),
    44: ("GenericParamConstraint", ["rid:42", "ci:TypeDefOrRef"]),
}


class DotNet:
    """Parses the CLI header, metadata heaps and the #~ table stream."""

    def __init__(self, pe: PE):
        self.pe = pe
        self.ok = False
        rva, size = pe.dir_entry("com_descriptor")
        if not rva:
            return
        cli = pe.read_rva(rva, 72)
        if len(cli) < 72:
            return
        self.runtime = f"{u16(cli, 4)}.{u16(cli, 6)}"
        self.cli_flags = u32(cli, 16)
        self.entry_token = u32(cli, 20)
        md_rva, md_size = u32(cli, 8), u32(cli, 12)
        self.md_off = pe.rva_to_off(md_rva)
        if self.md_off is None:
            return
        d = pe.data
        o = self.md_off
        if d[o:o + 4] != b"BSJB":
            return
        vlen = u32(d, o + 12)
        self.md_version = cstr(d, o + 16, vlen)
        p = o + 16 + vlen
        p += 2  # flags
        nstreams = u16(d, p)
        p += 2
        self.streams = OrderedDict()
        for _ in range(nstreams):
            soff, ssize = u32(d, p), u32(d, p + 4)
            p += 8
            name = cstr(d, p, 32)
            p += (len(name.encode()) + 1 + 3) & ~3
            self.streams[name] = (soff, ssize)
        self.strings = self._stream("#Strings")
        self.us = self._stream("#US")
        self.blob = self._stream("#Blob")
        self.guids = self._stream("#GUID")
        self._parse_tables()
        self.ok = True

    def _stream(self, name):
        if name not in self.streams:
            return b""
        so, ss = self.streams[name]
        return self.pe.data[self.md_off + so: self.md_off + so + ss]

    def s(self, idx):
        if idx >= len(self.strings):
            return ""
        return cstr(self.strings, idx, 512)

    # -- #~ ------------------------------------------------------------------
    def _parse_tables(self):
        tstream = "#~" if "#~" in self.streams else "#-"
        raw = self._stream(tstream)
        self.rows = {}
        self.table_data = {}
        if not raw:
            return
        heap_sizes = raw[6]
        self.str_w = 4 if heap_sizes & 1 else 2
        self.guid_w = 4 if heap_sizes & 2 else 2
        self.blob_w = 4 if heap_sizes & 4 else 2
        valid = u64(raw, 8)
        present = [i for i in range(64) if valid >> i & 1]
        p = 24
        for t in present:
            self.rows[t] = u32(raw, p)
            p += 4
        # column widths depend on all row counts, so compute after the header
        for t in present:
            if t not in TABLES:
                self.rows[t] = self.rows[t]
        for t in present:
            name, cols = TABLES.get(t, (f"Table{t}", None))
            if cols is None:
                # unknown table -> cannot size the rest; stop cleanly
                break
            width = sum(self._col_width(c) for c in cols)
            n = self.rows[t]
            self.table_data[t] = (p, width, cols, n)
            p += width * n

    def _col_width(self, col):
        if col == "u2":
            return 2
        if col == "u4":
            return 4
        if col == "str":
            return self.str_w
        if col == "guid":
            return self.guid_w
        if col == "blob":
            return self.blob_w
        if col.startswith("rid:"):
            t = int(col[4:])
            return 4 if self.rows.get(t, 0) >= (1 << 16) else 2
        if col.startswith("ci:"):
            tables, bits = CODED[col[3:]]
            limit = 1 << (16 - bits)
            big = any(self.rows.get(t, 0) >= limit for t in tables if t >= 0)
            return 4 if big else 2
        raise ValueError(col)

    def read_table(self, t):
        """Yield each row as a list of raw integer columns."""
        if t not in self.table_data:
            return
        raw = self._stream("#~" if "#~" in self.streams else "#-")
        base, width, cols, n = self.table_data[t]
        for i in range(n):
            o = base + i * width
            row = []
            for c in cols:
                w = self._col_width(c)
                row.append(u16(raw, o) if w == 2 else u32(raw, o))
                o += w
            yield row

    # -- convenience views ---------------------------------------------------
    def assembly(self):
        for r in self.read_table(32):
            return {"name": self.s(r[7]),
                    "version": f"{r[1]}.{r[2]}.{r[3]}.{r[4]}",
                    "culture": self.s(r[8]) or "neutral",
                    "flags": hex(r[5])}
        return {}

    def assembly_refs(self):
        return [{"name": self.s(r[6]),
                 "version": f"{r[0]}.{r[1]}.{r[2]}.{r[3]}"}
                for r in self.read_table(35)]

    def module_refs(self):
        return [self.s(r[0]) for r in self.read_table(26)]

    def pinvokes(self):
        """ImplMap -> [(native_symbol, dll)] : the real 'import table' of a .NET app."""
        mods = self.module_refs()
        out = []
        for r in self.read_table(28):
            dll = mods[r[3] - 1] if 0 < r[3] <= len(mods) else "?"
            out.append((self.s(r[2]), dll))
        return out

    def typerefs(self):
        return [(self.s(r[2]), self.s(r[1])) for r in self.read_table(1)]

    def manifest_resources(self):
        return [self.s(r[2]) for r in self.read_table(40)]

    def user_strings(self):
        """Walk the #US heap: each entry is compressed-length + UTF-16LE."""
        b, i, out = self.us, 1, []
        while i < len(b):
            first = b[i]
            if first & 0x80 == 0:
                ln, adv = first, 1
            elif first & 0xC0 == 0x80:
                ln, adv = ((first & 0x3F) << 8) | b[i + 1], 2
            else:
                ln = ((first & 0x1F) << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]
                adv = 4
            i += adv
            if ln == 0 or i + ln > len(b):
                break
            out.append(b[i:i + ln - 1].decode("utf-16-le", "replace"))
            i += ln
        return out


# --------------------------------------------------------------------------
# indicator extraction
# --------------------------------------------------------------------------

URL_RE = re.compile(r"\b(?:https?|ftp|ws|wss)://[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]{4,200}")
HOST_RE = re.compile(
    r"\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+"
    r"(?:com|net|org|io|co|dev|cn|ru|info|xyz|top|biz|online|site|live|app|cloud|me|tk)\b",
    re.I)
UNC_RE = re.compile(r"\\\\[A-Za-z0-9._$-]{2,}\\[A-Za-z0-9._$\\-]{2,}")
REG_RE = re.compile(r"\b(?:HKEY_[A-Z_]+|HKLM|HKCU)\\[A-Za-z0-9\\ _.-]{4,120}")
# not preceded/followed by another dotted number -> filters out version
# strings and OIDs such as "4.0.0.0" or "1.3.6.1.4.1.311"
IP_RE = re.compile(r"(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])")

SUSPECT_APIS = {
    "VirtualAlloc", "VirtualProtect", "WriteProcessMemory", "CreateRemoteThread",
    "SetWindowsHookEx", "LoadLibraryA", "LoadLibraryW", "GetProcAddress",
    "WinExec", "ShellExecuteA", "ShellExecuteW", "URLDownloadToFile",
    "InternetOpenUrl", "CryptEncrypt", "AdjustTokenPrivileges", "NtUnmapViewOfSection",
}


# A dotted identifier such as "System.IO" or "StoreInstaller.App" matches the
# hostname shape exactly, so bare hits are only reported once they survive this.
NAMESPACE_PREFIXES = ("system.", "microsoft.", "windows.", "mscorlib.",
                      "presentation.", "newtonsoft.")


def _is_namespace_like(host, namespaces):
    if host.startswith(NAMESPACE_PREFIXES):
        return True
    return host.split(".")[0] in namespaces


def extract_indicators(texts, namespaces=frozenset(), known_versions=frozenset()):
    """Split findings by confidence: hosts seen inside a URL are real network
    targets; bare dotted tokens are reported separately as needing review."""
    urls, bare, unc, regs, ips = set(), set(), set(), set(), set()
    for t in texts:
        urls.update(URL_RE.findall(t))
        bare.update(h.lower() for h in HOST_RE.findall(t))
        unc.update(UNC_RE.findall(t))
        regs.update(REG_RE.findall(t))
        for ip in IP_RE.findall(t):
            octets = [int(x) for x in ip.split(".")]
            if not all(o <= 255 for o in octets) or octets[0] in (0, 127):
                continue
            # assembly/product versions share IPv4's shape; drop the ones this
            # image actually declares as versions
            if ip in known_versions:
                continue
            ips.add(ip)
    in_urls = set()
    for u in urls:
        m = HOST_RE.search(u)
        if m:
            in_urls.add(m.group(0).lower())
    ns = {n.split(".")[0].lower() for n in namespaces}
    rest = bare - in_urls
    return {
        "urls": sorted(urls),
        "hosts_in_urls": sorted(in_urls),
        "hosts_bare": sorted(h for h in rest if not _is_namespace_like(h, ns)),
        "hosts_namespace_like": sorted(h for h in rest if _is_namespace_like(h, ns)),
        "unc_paths": sorted(unc),
        "registry_keys": sorted(regs),
        "ip_literals": sorted(ips),
    }


def wide_and_ascii_strings(data, minlen=6):
    out = []
    for m in re.finditer(rb"[\x20-\x7e]{%d,}" % minlen, data):
        out.append(m.group().decode("ascii"))
    for m in re.finditer(rb"(?:[\x20-\x7e]\x00){%d,}" % minlen, data):
        out.append(m.group().decode("utf-16-le", "replace"))
    return out


# --------------------------------------------------------------------------
# report
# --------------------------------------------------------------------------


def analyze(path, max_items=40):
    data = open(path, "rb").read()
    pe = PE(data)
    rep = OrderedDict()
    rep["file"] = {
        "path": path,
        "size": len(data),
        "md5": hashlib.md5(data).hexdigest(),
        "sha1": hashlib.sha1(data).hexdigest(),
        "sha256": hashlib.sha256(data).hexdigest(),
        "entropy": round(entropy(data), 3),
    }
    rep["pe"] = {
        "machine": MACHINES.get(pe.machine, hex(pe.machine)),
        "magic": "PE32+" if pe.plus else "PE32",
        "timestamp_raw": pe.timestamp,
        "subsystem": SUBSYSTEMS.get(pe.subsystem, pe.subsystem),
        "image_base": hex(pe.image_base),
        "entry_rva": hex(pe.entry_rva),
        "dll_characteristics": hex(pe.dll_characteristics),
        "aslr": bool(pe.dll_characteristics & 0x0040),
        "dep_nx": bool(pe.dll_characteristics & 0x0100),
        "high_entropy_va": bool(pe.dll_characteristics & 0x0020),
    }
    rep["sections"] = []
    for s in pe.sections:
        raw = data[s["rawptr"]:s["rawptr"] + s["rawsize"]]
        rep["sections"].append({
            "name": s["name"], "vaddr": hex(s["vaddr"]), "vsize": s["vsize"],
            "rawsize": s["rawsize"], "entropy": round(entropy(raw), 3),
            "flags": "|".join(n for f, n in SECTION_FLAGS.items() if s["flags"] & f),
        })
    rep["directories"] = {
        DIR_NAMES[i]: {"rva": hex(r), "size": sz}
        for i, (r, sz) in enumerate(pe.dirs) if sz
    }
    imps = pe.imports()
    rep["imports"] = {k: v[:max_items] for k, v in imps.items()}
    rep["import_summary"] = {
        "dll_count": len(imps),
        "function_count": sum(len(v) for v in imps.values()),
        "suspicious": sorted({f for v in imps.values() for f in v if f in SUSPECT_APIS}),
    }
    exp = pe.exports()
    if exp:
        rep["exports"] = exp[:max_items]
    rep["version_info"] = pe.version_info()
    rep["authenticode"] = pe.authenticode()

    dn = DotNet(pe)
    if dn.ok:
        us = dn.user_strings()
        pinv = dn.pinvokes()
        ns = Counter(n for n, _ in dn.typerefs() if n)
        rep["dotnet"] = {
            "runtime_version": dn.runtime,
            "metadata_version": dn.md_version,
            "il_only": bool(dn.cli_flags & 1),
            "entry_token": hex(dn.entry_token),
            "streams": {k: {"size": v[1]} for k, v in dn.streams.items()},
            "assembly": dn.assembly(),
            "assembly_refs": dn.assembly_refs(),
            "module_refs": dn.module_refs(),
            "pinvoke_count": len(pinv),
            "pinvokes": [f"{f} @ {d}" for f, d in sorted(pinv)][:400],
            "manifest_resources": dn.manifest_resources(),
            "typeref_namespaces": ns.most_common(max_items),
            "user_string_count": len(us),
        }
        namespaces = {n for n, _ in dn.typerefs() if n}
        namespaces |= {dn.s(r[2]) for r in dn.read_table(2) if dn.s(r[2])}
        known_versions = {r["version"] for r in rep["dotnet"]["assembly_refs"]}
        known_versions.add(rep["dotnet"]["assembly"].get("version", ""))
        known_versions |= {v for v in rep.get("version_info", {}).values()
                           if v.count(".") == 3}
        texts = list(us)
        texts += wide_and_ascii_strings(dn.strings)
    else:
        namespaces, known_versions = set(), set()
        texts = []
    texts += wide_and_ascii_strings(data)
    rep["indicators"] = extract_indicators(texts, namespaces, known_versions)
    return rep


def _print(rep, max_items):
    def head(t):
        print("\n" + "=" * 72 + f"\n{t}\n" + "=" * 72)

    head("FILE")
    for k, v in rep["file"].items():
        print(f"  {k:10} {v}")
    head("PE HEADER")
    for k, v in rep["pe"].items():
        print(f"  {k:22} {v}")
    head("SECTIONS")
    print(f"  {'name':10}{'vaddr':>12}{'vsize':>10}{'rawsize':>10}{'entropy':>9}  flags")
    for s in rep["sections"]:
        print(f"  {s['name']:10}{s['vaddr']:>12}{s['vsize']:>10}"
              f"{s['rawsize']:>10}{s['entropy']:>9}  {s['flags']}")
    head("NATIVE IMPORTS")
    for dll, fns in rep["imports"].items():
        print(f"  {dll}: {', '.join(fns) if fns else '(none resolved)'}")
    print(f"  -- {rep['import_summary']['dll_count']} DLL(s), "
          f"{rep['import_summary']['function_count']} function(s)")
    if rep["import_summary"]["suspicious"]:
        print(f"  !! flagged APIs: {', '.join(rep['import_summary']['suspicious'])}")
    if rep.get("version_info"):
        head("VERSION RESOURCE")
        for k, v in rep["version_info"].items():
            print(f"  {k:22} {v}")
    a = rep["authenticode"]
    head("AUTHENTICODE")
    print(f"  signed: {a['signed']}  blob_size: {a['blob_size']}")
    for c in a["certificates"]:
        print(f"  - subject : {c.get('subject')}")
        print(f"    issuer  : {c.get('issuer')}")
        print(f"    valid   : {c.get('not_before')} -> {c.get('not_after')}")
        print(f"    sha1    : {c.get('sha1')}")
    if "dotnet" in rep:
        d = rep["dotnet"]
        head(".NET METADATA")
        for k in ("runtime_version", "metadata_version", "il_only", "entry_token",
                  "user_string_count", "pinvoke_count"):
            print(f"  {k:22} {d[k]}")
        print(f"  assembly               {d['assembly']}")
        print(f"  streams                " +
              ", ".join(f"{k}({v['size']}B)" for k, v in d["streams"].items()))
        print("\n  -- AssemblyRef --")
        for r in d["assembly_refs"]:
            print(f"     {r['name']} {r['version']}")
        print("\n  -- ModuleRef (unmanaged DLLs) --")
        for m in d["module_refs"]:
            print(f"     {m}")
        print("\n  -- P/Invoke (native entry points) --")
        for p in d["pinvokes"][:max_items * 4]:
            print(f"     {p}")
        if d["manifest_resources"]:
            print("\n  -- Manifest resources --")
            for m in d["manifest_resources"]:
                print(f"     {m}")
        print("\n  -- Referenced namespaces (top) --")
        for n, c in d["typeref_namespaces"]:
            print(f"     {c:5}  {n}")
    head("NETWORK / SYSTEM INDICATORS")
    for k, vals in rep["indicators"].items():
        print(f"  {k} ({len(vals)}):")
        for v in vals[:max_items * 2]:
            print(f"     {v}")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("path")
    ap.add_argument("--json", help="also write the full report as JSON")
    ap.add_argument("--max", type=int, default=40, help="max items per list (default 40)")
    args = ap.parse_args()
    try:
        rep = analyze(args.path, args.max)
    except (ValueError, struct.error) as exc:
        print(f"error: {args.path}: {exc}", file=sys.stderr)
        return 2
    _print(rep, args.max)
    if args.json:
        with open(args.json, "w") as fh:
            json.dump(rep, fh, indent=2, ensure_ascii=False)
        print(f"\n[+] JSON report written to {args.json}")


if __name__ == "__main__":
    sys.exit(main())
