package com.kistrader.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.kistrader.core.Format
import com.kistrader.core.OrderRequest
import com.kistrader.core.Side
import com.kistrader.core.TickSize

/**
 * 수동 주문 입력 카드.
 *
 * 서버가 제어를 허용할 때만 화면에 나온다. 가격은 호가 단위 버튼으로만 조정할 수 있게 해
 * 서버가 거부할 값을 애초에 만들지 않도록 한다.
 */
@Composable
fun OrderCard(
    busy: Boolean,
    onSubmit: (OrderRequest) -> Unit,
) {
    var symbol by remember { mutableStateOf("") }
    var side by remember { mutableStateOf(Side.BUY) }
    var quantity by remember { mutableStateOf("") }
    var price by remember { mutableStateOf("") }
    var market by remember { mutableStateOf(false) }
    var pending by remember { mutableStateOf<OrderRequest?>(null) }

    val request = OrderRequest(
        symbol = symbol.trim(),
        side = side,
        quantity = quantity.toIntOrNull() ?: 0,
        price = price.toLongOrNull() ?: 0,
        market = market,
    )
    val validationError = request.validate()

    SectionCard(title = "수동 주문") {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(
                selected = side == Side.BUY,
                onClick = { side = Side.BUY },
                label = { Text("매수") },
            )
            FilterChip(
                selected = side == Side.SELL,
                onClick = { side = Side.SELL },
                label = { Text("매도") },
            )
        }

        OutlinedTextField(
            value = symbol,
            onValueChange = { input -> symbol = input.filter(Char::isDigit).take(6) },
            label = { Text("종목코드") },
            placeholder = { Text("005930") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            modifier = Modifier.fillMaxWidth(),
        )

        OutlinedTextField(
            value = quantity,
            onValueChange = { input -> quantity = input.filter(Char::isDigit).take(7) },
            label = { Text("수량") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            modifier = Modifier.fillMaxWidth(),
        )

        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = market, onCheckedChange = { market = it })
            Text("시장가로 주문", style = MaterialTheme.typography.bodyMedium)
        }

        if (!market) {
            OutlinedTextField(
                value = price,
                onValueChange = { input -> price = input.filter(Char::isDigit).take(9) },
                label = { Text("가격") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                supportingText = {
                    val current = price.toLongOrNull() ?: 0
                    if (current > 0) Text("호가 단위 ${Format.number(TickSize.of(current))}원")
                },
                modifier = Modifier.fillMaxWidth(),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = {
                    val current = price.toLongOrNull() ?: 0
                    if (current > 0) price = TickSize.step(current, up = false).toString()
                }) { Text("− 한 틱") }
                TextButton(onClick = {
                    val current = price.toLongOrNull() ?: 0
                    if (current > 0) price = TickSize.step(current, up = true).toString()
                }) { Text("+ 한 틱") }
            }
        }

        Button(
            onClick = { pending = request },
            enabled = !busy && validationError == null,
            colors = ButtonDefaults.buttonColors(
                containerColor = LocalTrendColors.current.of(if (side == Side.BUY) 1L else -1L),
            ),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (busy) "처리 중..." else "${side.korean} 주문")
        }

        Text(
            validationError ?: "서버가 리스크 한도로 수량을 줄일 수 있습니다. 접수 결과를 확인하세요.",
            style = MaterialTheme.typography.bodySmall,
            color = if (validationError != null) {
                MaterialTheme.colorScheme.error
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
        )
    }

    pending?.let { confirmed ->
        ConfirmDialog(
            title = "${confirmed.side.korean} 주문",
            message = buildString {
                append("${confirmed.symbol} ${Format.number(confirmed.quantity)}주를 ")
                append(if (confirmed.market) "시장가" else "${Format.won(confirmed.price)}에")
                append(" ${confirmed.side.korean}합니다.")
            },
            confirmLabel = "${confirmed.side.korean} 실행",
            destructive = true,
            onConfirm = {
                pending = null
                onSubmit(confirmed)
                quantity = ""
                price = ""
            },
            onDismiss = { pending = null },
        )
    }
}
