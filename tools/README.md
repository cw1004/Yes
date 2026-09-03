# tools/

Standalone utilities that are not part of the `india2030` video pipeline.

## `pe_dotnet_analyzer.py`

Static analyzer for Windows PE files, with extra depth for .NET/CLI assemblies.
Pure standard library — no `pefile`, no `dnSpy`, no Windows needed. It never
executes the sample.

```bash
python3 tools/pe_dotnet_analyzer.py <file.exe>
python3 tools/pe_dotnet_analyzer.py <file.exe> --json report.json --max 100
```

What it reports:

| Section | Contents |
|---|---|
| FILE | size, MD5/SHA1/SHA256, whole-file entropy |
| PE HEADER | machine, PE32/PE32+, entrypoint, image base, ASLR/DEP/HEVA flags |
| SECTIONS | virtual/raw sizes, per-section Shannon entropy, characteristics |
| NATIVE IMPORTS | import table + a flag list of commonly abused APIs |
| VERSION RESOURCE | CompanyName, ProductName, FileVersion, OriginalFilename, … |
| AUTHENTICODE | signed or not, plus every embedded certificate's subject, issuer, validity window and SHA1 (hand-rolled ASN.1/X.509 parser) |
| .NET METADATA | CLI header, metadata heaps, `Assembly`/`AssemblyRef`, `ModuleRef`, **P/Invoke map (`ImplMap`)**, manifest resources, referenced namespaces |
| INDICATORS | URLs, hostnames, UNC paths, registry keys, IPv4 literals |

### Notes on the .NET side

A managed executable imports exactly one native function (`mscoree!_CorExeMain`),
so the native import table says nothing about behaviour. The real equivalent is
the `ImplMap` metadata table, which this tool decodes into
`symbol @ library` pairs. Reaching it means parsing the `#~` table stream:
the parser implements the full ECMA-335 table schema and coded-index sizing,
because every table's row width depends on the row counts of the tables before
it.

### False positives

Dotted .NET identifiers (`System.IO`, `StoreInstaller.App`) match the hostname
grammar, and assembly versions (`4.0.0.0`) match the IPv4 grammar. The tool
separates its findings accordingly:

* `hosts_in_urls` — seen inside a real URL, high confidence
* `hosts_bare` — bare dotted token that is not namespace-shaped, review it
* `hosts_namespace_like` — almost certainly a type or namespace name
* `ip_literals` — versions the image itself declares are filtered out; anything
  left may still be a version string, so check it in context
