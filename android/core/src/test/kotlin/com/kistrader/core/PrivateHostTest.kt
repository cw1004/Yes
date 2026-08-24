package com.kistrader.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PrivateHostTest {

    @Test
    fun `주소에서 호스트만 뽑는다`() {
        assertEquals("192.168.0.5", PrivateHost.hostOf("http://192.168.0.5:8000/"))
        assertEquals("192.168.0.5", PrivateHost.hostOf("192.168.0.5"))
        assertEquals("home.example", PrivateHost.hostOf("https://home.example:8000/api"))
        assertEquals("::1", PrivateHost.hostOf("http://[::1]:8000"))
    }

    @Test
    fun `사설 대역과 루프백은 안전으로 본다`() {
        listOf(
            "192.168.0.5", "192.168.100.200", "10.0.0.1", "10.255.255.254",
            "172.16.0.1", "172.31.255.254", "127.0.0.1", "169.254.1.1",
            "100.101.102.103", "localhost", "nas.local",
        ).forEach { assertTrue("$it 는 사설이어야 한다", PrivateHost.isPrivate(it)) }
    }

    @Test
    fun `공인 주소는 사설이 아니다`() {
        listOf(
            "8.8.8.8", "1.1.1.1", "172.32.0.1", "172.15.0.1",
            "192.169.0.1", "203.0.113.10", "example.com", "",
        ).forEach { assertFalse("$it 는 공인이어야 한다", PrivateHost.isPrivate(it)) }
    }

    @Test
    fun `잘못된 형식은 사설로 오인하지 않는다`() {
        listOf("999.1.1.1", "1.2.3", "1.2.3.4.5", "abc.def.ghi.jkl").forEach {
            assertFalse("$it", PrivateHost.isPrivate(it))
        }
    }

    @Test
    fun `평문으로 공인 주소에 붙으면 경고한다`() {
        val warning = PrivateHost.warningFor("http://203.0.113.10:8000")
        assertNotNull(warning)
        assertTrue(warning!!.contains("HTTP"))
    }

    @Test
    fun `사설 주소와 HTTPS 는 경고하지 않는다`() {
        assertNull(PrivateHost.warningFor("http://192.168.0.5:8000"))
        assertNull(PrivateHost.warningFor("https://myhome.example:8000"))
    }
}
