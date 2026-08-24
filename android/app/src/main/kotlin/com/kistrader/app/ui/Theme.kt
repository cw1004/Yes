package com.kistrader.app.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import com.kistrader.core.Trend

/*
 * 웹 대시보드와 같은 팔레트를 쓴다 — 두 화면을 오갈 때 같은 시스템으로 보이도록.
 * 상승 빨강 / 하락 파랑은 국내 관례이며, Material 의 error 색과는 별개다.
 */
private val Blue = Color(0xFF2563EB)
private val BlueDark = Color(0xFF5B8CFF)
private val UpLight = Color(0xFFD92B2B)
private val UpDark = Color(0xFFFF5C5C)
private val DownLight = Color(0xFF1F6FEB)
private val DownDark = Color(0xFF5B9BFF)

private val LightColors = lightColorScheme(
    primary = Blue,
    onPrimary = Color.White,
    secondary = Color(0xFF4B5563),
    background = Color(0xFFF4F5F7),
    onBackground = Color(0xFF16181D),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF16181D),
    surfaceVariant = Color(0xFFEDEFF3),
    onSurfaceVariant = Color(0xFF6B7280),
    outline = Color(0xFFE3E5E9),
    error = Color(0xFFC62828),
    onError = Color.White,
)

private val DarkColors = darkColorScheme(
    primary = BlueDark,
    onPrimary = Color(0xFF0B1020),
    secondary = Color(0xFF9AA1AE),
    background = Color(0xFF0F1115),
    onBackground = Color(0xFFE7E9EE),
    surface = Color(0xFF171A21),
    onSurface = Color(0xFFE7E9EE),
    surfaceVariant = Color(0xFF1E222B),
    onSurfaceVariant = Color(0xFF9AA1AE),
    outline = Color(0xFF262B35),
    error = Color(0xFFFF6B6B),
    onError = Color(0xFF2A0A0A),
)

/** 등락 색은 Material 색 역할에 없으므로 따로 내려준다. */
data class TrendColors(val up: Color, val down: Color, val flat: Color) {
    fun of(trend: Trend): Color = when (trend) {
        Trend.UP -> up
        Trend.DOWN -> down
        Trend.FLAT -> flat
    }

    fun of(value: Long): Color = of(Trend.of(value))
    fun of(value: Double): Color = of(Trend.of(value))
}

val LocalTrendColors = staticCompositionLocalOf {
    TrendColors(up = UpLight, down = DownLight, flat = Color(0xFF6B7280))
}

@Composable
fun KisTraderTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val colors = if (darkTheme) DarkColors else LightColors
    val trend = if (darkTheme) {
        TrendColors(up = UpDark, down = DownDark, flat = Color(0xFF9AA1AE))
    } else {
        TrendColors(up = UpLight, down = DownLight, flat = Color(0xFF6B7280))
    }

    CompositionLocalProvider(LocalTrendColors provides trend) {
        MaterialTheme(colorScheme = colors, content = content)
    }
}
