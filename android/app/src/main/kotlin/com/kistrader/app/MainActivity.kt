package com.kistrader.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.kistrader.app.ui.DashboardScreen
import com.kistrader.app.ui.KisTraderTheme
import com.kistrader.app.ui.SetupScreen
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            KisTraderTheme {
                App()
            }
        }
    }
}

@Composable
private fun App(viewModel: DashboardViewModel = viewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    when (state.screen) {
        Screen.SETUP -> SetupScreen(
            initialUrl = viewModel.savedBaseUrl,
            initialToken = viewModel.savedToken,
            loading = state.loading,
            error = state.error,
            onConnect = viewModel::connect,
        )

        Screen.DASHBOARD -> {
            AutoRefresh(
                intervalSeconds = state.config?.refreshSeconds ?: 10,
                onTick = viewModel::refresh,
            )
            DashboardScreen(
                state = state,
                onRefresh = viewModel::refresh,
                onSetHalt = viewModel::setHalt,
                onCancel = viewModel::cancel,
                onCancelAll = viewModel::cancelAll,
                onOrder = viewModel::placeOrder,
                onDisconnect = viewModel::disconnect,
                onMessageShown = viewModel::consumeMessage,
            )
        }
    }
}

/**
 * 화면이 보이는 동안에만 주기적으로 갱신한다.
 *
 * 백그라운드에서도 계속 돌면 배터리와 데이터를 낭비하고, 집 밖에 있을 때는 어차피
 * 서버에 닿지도 못한다. [Lifecycle.State.RESUMED] 로 묶어 앱을 내리면 멈추게 한다.
 */
@Composable
private fun AutoRefresh(intervalSeconds: Int, onTick: () -> Unit) {
    val lifecycleOwner = LocalLifecycleOwner.current
    LaunchedEffect(lifecycleOwner, intervalSeconds) {
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (isActive) {
                delay(intervalSeconds.coerceIn(3, 300) * 1000L)
                onTick()
            }
        }
    }
}
