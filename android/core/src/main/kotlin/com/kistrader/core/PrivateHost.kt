package com.kistrader.core

/**
 * 접속 주소가 집 안(사설망)인지 판별한다.
 *
 * 대시보드는 평문 HTTP 라서 공인 인터넷 주소로 붙으면 토큰이 그대로 노출된다.
 * 사용자가 공유기 포트포워딩으로 외부에 열어 둔 주소를 입력하면 앱이 경고할 수 있도록,
 * 주소가 사설 대역인지 여기서 확인한다.
 */
object PrivateHost {

    /** 주소가 사설망(LAN)·루프백이면 true. HTTPS 는 암호화되므로 항상 안전으로 본다. */
    fun isSafe(baseUrl: String): Boolean {
        val normalized = baseUrl.trim()
        if (normalized.startsWith("https://", ignoreCase = true)) return true
        return isPrivate(hostOf(normalized))
    }

    /** `http://192.168.0.5:8000/` → `192.168.0.5` */
    fun hostOf(baseUrl: String): String {
        var text = baseUrl.trim()
        val schemeIndex = text.indexOf("://")
        if (schemeIndex >= 0) text = text.substring(schemeIndex + 3)
        text = text.substringBefore('/')
        return if (text.startsWith("[")) {
            text.substringAfter('[').substringBefore(']')   // IPv6
        } else {
            text.substringBefore(':')
        }.lowercase()
    }

    /** RFC1918 사설 대역, 루프백, 링크로컬, 그리고 흔한 로컬 호스트 이름. */
    fun isPrivate(host: String): Boolean {
        if (host.isEmpty()) return false
        if (host == "localhost" || host.endsWith(".local") || host.endsWith(".lan")) return true
        if (host == "::1") return true

        val parts = host.split('.')
        if (parts.size != 4) return false
        val octets = parts.map { it.toIntOrNull() ?: return false }
        if (octets.any { it !in 0..255 }) return false

        val (first, second) = octets
        return when {
            first == 10 -> true                        // 10.0.0.0/8
            first == 127 -> true                       // 루프백
            first == 172 && second in 16..31 -> true    // 172.16.0.0/12
            first == 192 && second == 168 -> true       // 192.168.0.0/16
            first == 169 && second == 254 -> true       // 링크로컬
            first == 100 && second in 64..127 -> true   // CGNAT (Tailscale 등)
            else -> false
        }
    }

    /** 위험한 주소일 때 사용자에게 보여줄 경고. 안전하면 null. */
    fun warningFor(baseUrl: String): String? = if (isSafe(baseUrl)) {
        null
    } else {
        "이 주소는 집 안 네트워크가 아닙니다. 대시보드는 암호화되지 않은 HTTP 라서 " +
            "외부 인터넷으로 접속하면 토큰과 계좌 정보가 그대로 노출됩니다. " +
            "같은 와이파이에서 사설 IP(192.168.x.x 등)로 접속하거나 VPN 을 사용하세요."
    }
}
