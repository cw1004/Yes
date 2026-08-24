package com.kistrader.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.kistrader.core.KisClient
import com.kistrader.core.PrivateHost

/**
 * 서버 주소와 토큰을 입력받는 첫 화면.
 *
 * 입력한 주소가 집 안 네트워크가 아니면 연결 전에 경고한다 — 평문 HTTP 라서
 * 공인 주소로 붙으면 토큰이 그대로 노출되기 때문이다.
 */
@Composable
fun SetupScreen(
    initialUrl: String,
    initialToken: String,
    loading: Boolean,
    error: String?,
    onConnect: (String, String) -> Unit,
) {
    var url by remember { mutableStateOf(initialUrl) }
    var token by remember { mutableStateOf(initialToken) }

    val normalized = KisClient.normalizeBaseUrl(url)
    val hostWarning = if (normalized.isEmpty()) null else PrivateHost.warningFor(normalized)

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("KIS 대시보드 연결", style = MaterialTheme.typography.headlineSmall)
        Text(
            "PC 에서 python -m kis web --host 0.0.0.0 을 실행하면 터미널에 주소와 토큰이 출력됩니다.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        OutlinedTextField(
            value = url,
            onValueChange = { url = it },
            label = { Text("서버 주소") },
            placeholder = { Text("192.168.0.5:8000") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next),
            supportingText = {
                if (normalized.isNotEmpty()) Text("연결 대상: $normalized")
            },
            modifier = Modifier.fillMaxWidth(),
        )

        OutlinedTextField(
            value = token,
            onValueChange = { token = it },
            label = { Text("접속 토큰") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
            modifier = Modifier.fillMaxWidth(),
        )

        if (hostWarning != null) {
            SectionCard(title = "⚠ 주의") {
                Text(
                    hostWarning,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
        }

        if (error != null) {
            Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
        }

        Button(
            onClick = { onConnect(url, token) },
            enabled = !loading && url.isNotBlank() && token.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (loading) {
                CircularProgressIndicator(
                    modifier = Modifier.padding(end = 8.dp),
                    strokeWidth = 2.dp,
                )
            }
            Text(if (loading) "연결 중..." else "연결")
        }

        SectionCard(title = "안전하게 쓰는 법") {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf(
                    "폰과 PC 가 같은 와이파이에 있어야 합니다.",
                    "대시보드는 암호화되지 않은 HTTP 입니다. 공유기 포트포워딩으로 외부에 열지 마세요.",
                    "서버 기본값은 읽기 전용이라 조회와 매매 중단만 가능합니다. 주문까지 하려면 PC 에서 --allow-control 을 붙여 실행하세요.",
                    "토큰은 기기에 암호화해 저장되며 백업에서 제외됩니다.",
                ).forEach { line ->
                    Text(
                        "· $line",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}
