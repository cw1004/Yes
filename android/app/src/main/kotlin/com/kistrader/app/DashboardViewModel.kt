package com.kistrader.app

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.kistrader.core.ApiException
import com.kistrader.core.KisClient
import com.kistrader.core.OpenOrder
import com.kistrader.core.OrderRequest
import com.kistrader.core.ServerConfig
import com.kistrader.core.Snapshot
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** 지금 어느 화면에 있는지. */
enum class Screen { SETUP, DASHBOARD }

data class UiState(
    val screen: Screen = Screen.SETUP,
    val config: ServerConfig? = null,
    val snapshot: Snapshot? = null,
    /** 첫 로딩 중(화면에 아직 아무것도 없음) */
    val loading: Boolean = false,
    /** 주문·취소 등 사용자가 누른 동작을 처리 중 */
    val busy: Boolean = false,
    /** 연결 실패 등 화면 상단에 계속 띄워 둘 오류 */
    val error: String? = null,
    /** 스낵바로 한 번만 보여줄 메시지 */
    val message: String? = null,
    /** 마지막으로 갱신에 성공한 서버 시각 */
    val lastUpdated: String = "",
) {
    val allowControl: Boolean get() = config?.allowControl == true
    val halted: Boolean get() = snapshot?.summary?.halted == true
}

class DashboardViewModel(application: Application) : AndroidViewModel(application) {

    private val session = SessionStore(application)
    private var client: KisClient? = null

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    /** 저장된 주소·토큰. 설정 화면의 초기값으로 쓴다. */
    val savedBaseUrl: String get() = session.baseUrl
    val savedToken: String get() = session.token

    init {
        if (session.hasSession) {
            client = KisClient(session.baseUrl, session.token)
            _state.update { it.copy(screen = Screen.DASHBOARD, loading = true) }
            refresh()
        }
    }

    // ------------------------------------------------------------------ 연결
    /** 설정 화면에서 [연결] 을 눌렀을 때. 성공하면 저장하고 대시보드로 넘어간다. */
    fun connect(rawUrl: String, token: String) {
        val baseUrl = KisClient.normalizeBaseUrl(rawUrl)
        if (baseUrl.isEmpty()) {
            _state.update { it.copy(error = "서버 주소를 입력하세요") }
            return
        }
        if (token.isBlank()) {
            _state.update { it.copy(error = "토큰을 입력하세요") }
            return
        }

        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            val candidate = KisClient(baseUrl, token.trim())
            val result = runCatching { withContext(Dispatchers.IO) { candidate.config() } }

            result.onSuccess { config ->
                session.save(baseUrl, token.trim())
                client = candidate
                _state.update {
                    it.copy(screen = Screen.DASHBOARD, config = config, loading = true, error = null)
                }
                refresh()
            }.onFailure { error ->
                _state.update { it.copy(loading = false, error = describe(error)) }
            }
        }
    }

    fun disconnect() {
        session.clear()
        client = null
        _state.value = UiState(screen = Screen.SETUP)
    }

    // ------------------------------------------------------------------ 갱신
    fun refresh() {
        val api = client ?: return
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { api.snapshot() } }
            result.onSuccess { snapshot ->
                _state.update {
                    it.copy(
                        snapshot = snapshot,
                        loading = false,
                        error = null,
                        lastUpdated = snapshot.summary.serverTime,
                    )
                }
                // 서버 설정(제어 허용 여부)을 아직 모르면 함께 받아 둔다.
                if (_state.value.config == null) loadConfig()
            }.onFailure { error ->
                if (error is ApiException.Unauthorized) {
                    // 서버가 재시작되며 토큰이 바뀐 경우다. 다시 입력받아야 한다.
                    session.clear()
                    client = null
                    _state.value = UiState(screen = Screen.SETUP, error = describe(error))
                } else {
                    _state.update { it.copy(loading = false, error = describe(error)) }
                }
            }
        }
    }

    private fun loadConfig() {
        val api = client ?: return
        viewModelScope.launch {
            runCatching { withContext(Dispatchers.IO) { api.config() } }
                .onSuccess { config -> _state.update { it.copy(config = config) } }
        }
    }

    // ------------------------------------------------------------------ 제어
    /**
     * 매매 중단/재개.
     *
     * 중단은 읽기 전용 서버에서도 항상 허용된다 — 위험을 줄이는 방향이기 때문이다.
     */
    fun setHalt(halt: Boolean) = runAction(
        action = { api -> api.setHalt(halt) },
        onSuccess = { _ -> if (halt) "매매를 중단했습니다" else "매매를 재개했습니다" },
    )

    fun cancel(order: OpenOrder) = runAction(
        action = { api -> api.cancel(order) },
        onSuccess = { result -> if (result.success) "취소 요청을 보냈습니다" else result.message },
    )

    fun cancelAll() = runAction(
        action = { api -> api.cancelAll() },
        onSuccess = { result -> result.message },
    )

    fun placeOrder(request: OrderRequest) = runAction(
        action = { api -> api.placeOrder(request) },
        onSuccess = { result ->
            when {
                !result.success -> result.message
                result.quantity in 1 until request.quantity ->
                    "주문 접수 · 리스크 한도로 ${request.quantity}주 → ${result.quantity}주로 줄였습니다"
                result.dryRun -> "DRY-RUN 접수 (실제 주문은 나가지 않았습니다)"
                else -> "주문 접수 (${result.quantity}주, ${result.orderNo})"
            }
        },
    )

    /** 동작 하나를 실행하고, 끝나면 스냅샷을 다시 받아 화면을 최신으로 만든다. */
    private fun <T> runAction(action: suspend (KisClient) -> T, onSuccess: (T) -> String) {
        val api = client ?: return
        if (_state.value.busy) return   // 연타로 주문이 두 번 나가지 않게 막는다.

        _state.update { it.copy(busy = true) }
        viewModelScope.launch {
            runCatching { withContext(Dispatchers.IO) { action(api) } }
                .onSuccess { result ->
                    _state.update { it.copy(busy = false, message = onSuccess(result)) }
                    refresh()
                }
                .onFailure { error ->
                    _state.update { it.copy(busy = false, message = describe(error)) }
                }
        }
    }

    fun consumeMessage() = _state.update { it.copy(message = null) }

    private fun describe(error: Throwable): String = when (error) {
        is ApiException -> error.message ?: "알 수 없는 오류"
        else -> error.message ?: error::class.java.simpleName
    }
}
