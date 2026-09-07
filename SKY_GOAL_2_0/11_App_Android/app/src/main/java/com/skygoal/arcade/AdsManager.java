package com.skygoal.arcade;

import android.app.Activity;
import android.os.SystemClock;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.FrameLayout;

import com.google.android.gms.ads.AdError;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.AdSize;
import com.google.android.gms.ads.AdView;
import com.google.android.gms.ads.FullScreenContentCallback;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.MobileAds;
import com.google.android.gms.ads.interstitial.InterstitialAd;
import com.google.android.gms.ads.interstitial.InterstitialAdLoadCallback;
import com.google.android.gms.ads.rewarded.RewardedAd;
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback;
import com.google.android.ump.ConsentInformation;
import com.google.android.ump.ConsentRequestParameters;
import com.google.android.ump.UserMessagingPlatform;

/**
 * 광고 정책
 * - 배너: 하단 고정. 게임 화면을 가리지 않도록 별도 슬롯에 넣는다.
 * - 전면: 게임 오버 이후에만, 3판마다 + 최소 90초 간격.
 * - 보상형: 사용자가 "이어하기"를 직접 눌렀을 때만.
 * 플레이 중 화면을 덮는 광고는 절대 띄우지 않는다 (구글 정책 및 이탈률).
 */
public class AdsManager {

    private static final String TAG = "SkyGoalAds";
    private static final int INTERSTITIAL_EVERY_N_GAMES = 3;
    private static final long INTERSTITIAL_MIN_GAP_MS = 90_000L;

    private final Activity activity;
    private final FrameLayout adSlot;
    private final WebView web;

    private AdView banner;
    private InterstitialAd interstitial;
    private RewardedAd rewarded;
    private long lastInterstitialAt = 0L;
    private boolean initialized = false;

    public AdsManager(Activity activity, FrameLayout adSlot, WebView web) {
        this.activity = activity;
        this.adSlot = adSlot;
        this.web = web;
        requestConsentThenInit();
    }

    /** EU 사용자 동의(UMP)를 먼저 받고 광고 SDK 를 초기화한다. */
    private void requestConsentThenInit() {
        ConsentRequestParameters params = new ConsentRequestParameters.Builder().build();
        ConsentInformation info = UserMessagingPlatform.getConsentInformation(activity);
        info.requestConsentInfoUpdate(activity, params,
                () -> UserMessagingPlatform.loadAndShowConsentFormIfRequired(activity, error -> {
                    if (error != null) Log.w(TAG, "동의 폼: " + error.getMessage());
                    initAds();
                }),
                error -> {
                    Log.w(TAG, "동의 정보 갱신 실패: " + error.getMessage());
                    initAds();
                });
    }

    private void initAds() {
        if (initialized) return;
        initialized = true;
        new Thread(() -> MobileAds.initialize(activity, status -> activity.runOnUiThread(() -> {
            loadBanner();
            loadInterstitial();
            loadRewarded();
        }))).start();
    }

    private AdRequest request() {
        return new AdRequest.Builder().build();
    }

    private void loadBanner() {
        if (banner != null) return;
        banner = new AdView(activity);
        banner.setAdUnitId(activity.getString(R.string.admob_banner_id));
        banner.setAdSize(AdSize.BANNER);
        adSlot.removeAllViews();
        adSlot.addView(banner, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        banner.loadAd(request());
    }

    private void loadInterstitial() {
        InterstitialAd.load(activity, activity.getString(R.string.admob_interstitial_id), request(),
                new InterstitialAdLoadCallback() {
                    @Override public void onAdLoaded(InterstitialAd ad) { interstitial = ad; }
                    @Override public void onAdFailedToLoad(LoadAdError e) {
                        interstitial = null;
                        Log.w(TAG, "전면 광고 로드 실패: " + e.getMessage());
                    }
                });
    }

    private void loadRewarded() {
        RewardedAd.load(activity, activity.getString(R.string.admob_rewarded_id), request(),
                new RewardedAdLoadCallback() {
                    @Override public void onAdLoaded(RewardedAd ad) { rewarded = ad; }
                    @Override public void onAdFailedToLoad(LoadAdError e) {
                        rewarded = null;
                        Log.w(TAG, "보상형 광고 로드 실패: " + e.getMessage());
                    }
                });
    }

    /** 게임 오버 시점에만 호출된다. */
    public void maybeShowInterstitial(int totalGames) {
        activity.runOnUiThread(() -> {
            long now = SystemClock.elapsedRealtime();
            boolean turn = totalGames > 0 && totalGames % INTERSTITIAL_EVERY_N_GAMES == 0;
            boolean cooled = now - lastInterstitialAt >= INTERSTITIAL_MIN_GAP_MS;
            if (interstitial == null || !turn || !cooled) return;

            interstitial.setFullScreenContentCallback(new FullScreenContentCallback() {
                @Override public void onAdDismissedFullScreenContent() {
                    interstitial = null;
                    lastInterstitialAt = SystemClock.elapsedRealtime();
                    loadInterstitial();
                }
                @Override public void onAdFailedToShowFullScreenContent(AdError e) {
                    interstitial = null;
                    loadInterstitial();
                }
            });
            interstitial.show(activity);
        });
    }

    public boolean isRewardedReady() {
        return rewarded != null;
    }

    /** 이어하기 보상형 광고. 결과를 웹으로 되돌려 준다. */
    public void showRewarded() {
        activity.runOnUiThread(() -> {
            if (rewarded == null) {
                sendRewardResult(false);
                loadRewarded();
                return;
            }
            final boolean[] earned = { false };
            rewarded.setFullScreenContentCallback(new FullScreenContentCallback() {
                @Override public void onAdDismissedFullScreenContent() {
                    rewarded = null;
                    sendRewardResult(earned[0]);
                    loadRewarded();
                }
                @Override public void onAdFailedToShowFullScreenContent(AdError e) {
                    rewarded = null;
                    sendRewardResult(false);
                    loadRewarded();
                }
            });
            rewarded.show(activity, reward -> earned[0] = true);
        });
    }

    private void sendRewardResult(boolean granted) {
        web.post(() -> web.evaluateJavascript(
                "window.SkyGoal && window.SkyGoal.onRewardResult(" + granted + ")", null));
    }

    public void onPause() { if (banner != null) banner.pause(); }
    public void onResume() { if (banner != null) banner.resume(); }
    public void onDestroy() { if (banner != null) { banner.destroy(); banner = null; } }
}
