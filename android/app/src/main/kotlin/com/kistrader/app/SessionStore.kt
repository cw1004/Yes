package com.kistrader.app

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * 서버 주소와 접속 토큰 보관소.
 *
 * 토큰은 계좌 조회와(제어 모드에서는) 주문까지 가능하게 하는 값이므로 암호화해 저장한다.
 * 기기 키스토어가 망가진 드문 경우에는 앱이 아예 못 켜지는 것보다 낫도록 일반 저장소로
 * 물러나되, 그 사실을 로그로 남긴다.
 */
class SessionStore(context: Context) {

    private val prefs: SharedPreferences = createPreferences(context)

    var baseUrl: String
        get() = prefs.getString(KEY_BASE_URL, "").orEmpty()
        private set(value) = prefs.edit().putString(KEY_BASE_URL, value).apply()

    var token: String
        get() = prefs.getString(KEY_TOKEN, "").orEmpty()
        private set(value) = prefs.edit().putString(KEY_TOKEN, value).apply()

    val hasSession: Boolean get() = baseUrl.isNotBlank() && token.isNotBlank()

    fun save(baseUrl: String, token: String) {
        prefs.edit()
            .putString(KEY_BASE_URL, baseUrl)
            .putString(KEY_TOKEN, token)
            .apply()
    }

    fun clear() {
        prefs.edit().remove(KEY_BASE_URL).remove(KEY_TOKEN).apply()
    }

    private companion object {
        const val FILE_NAME = "kis-session"
        const val KEY_BASE_URL = "base_url"
        const val KEY_TOKEN = "token"
        const val TAG = "SessionStore"

        fun createPreferences(context: Context): SharedPreferences = try {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            EncryptedSharedPreferences.create(
                context,
                FILE_NAME,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        } catch (error: Exception) {
            Log.w(TAG, "암호화 저장소를 쓸 수 없어 일반 저장소로 대체합니다", error)
            context.getSharedPreferences("$FILE_NAME-plain", Context.MODE_PRIVATE)
        }
    }
}
