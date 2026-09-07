package com.skygoal.arcade;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.appcompat.app.AppCompatActivity;
import androidx.webkit.WebViewAssetLoader;

/**
 * 게임은 assets/game/index.html 하나로 들어있다.
 * file:// 대신 WebViewAssetLoader 로 https://appassets.androidplatform.net 에 매핑해
 * localStorage 오리진이 안정적으로 유지되도록 한다.
 */
public class MainActivity extends AppCompatActivity {

    private static final String BASE = "https://appassets.androidplatform.net/assets/game/index.html";

    private WebView web;
    private AdsManager ads;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        goImmersive();

        web = findViewById(R.id.web);
        FrameLayout adSlot = findViewById(R.id.ad_slot);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                 // localStorage 저장에 필요
        s.setMediaPlaybackRequiresUserGesture(false); // 첫 탭 이후 효과음이 끊기지 않게
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        web.setBackgroundColor(0xFF07111F);
        web.setLongClickable(false);
        web.setOnLongClickListener(v -> true);        // 길게 눌러 텍스트 선택 방지

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return true;                          // 외부 링크로 이탈하지 않는다
            }
        });

        ads = new AdsManager(this, adSlot, web);
        web.addJavascriptInterface(new NativeBridge(ads), "SkyGoalNative");
        web.loadUrl(BASE);

        getOnBackPressedDispatcher().addCallback(this,
                new androidx.activity.OnBackPressedCallback(true) {
                    @Override
                    public void handleOnBackPressed() {
                        // 게임 중이면 메인으로, 메인이면 앱 종료
                        web.evaluateJavascript(
                                "(function(){var s=window.SkyGoal&&window.SkyGoal.getState();"
                                        + "if(s&&s!=='idle'){window.SkyGoal.home();return 'handled';}"
                                        + "return 'exit';})()",
                                value -> {
                                    if (value == null || value.contains("exit")) finish();
                                });
                    }
                });
    }

    private void goImmersive() {
        View decor = getWindow().getDecorView();
        int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
        decor.setSystemUiVisibility(flags);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) goImmersive();
    }

    @Override protected void onPause() { if (web != null) web.onPause(); ads.onPause(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); ads.onResume(); }
    @Override protected void onDestroy() { ads.onDestroy(); super.onDestroy(); }
}
