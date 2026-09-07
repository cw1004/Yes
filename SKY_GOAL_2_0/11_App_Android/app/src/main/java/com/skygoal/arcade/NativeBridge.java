package com.skygoal.arcade;

import android.webkit.JavascriptInterface;

/**
 * 웹 게임 → 안드로이드 호출 창구. window.SkyGoalNative 로 노출된다.
 * ProGuard 규칙(proguard-rules.pro)에서 이 클래스의 메서드를 보존한다.
 */
public class NativeBridge {

    private final AdsManager ads;

    public NativeBridge(AdsManager ads) {
        this.ads = ads;
    }

    /** 한 판이 끝났을 때 호출된다. 빈도 제한을 지켜 전면 광고를 띄운다. */
    @JavascriptInterface
    public void gameOver(int score, int totalGames) {
        ads.maybeShowInterstitial(totalGames);
    }

    /** 보상형 광고가 준비되어 있는지 */
    @JavascriptInterface
    public boolean hasRewarded() {
        return ads.isRewardedReady();
    }

    /** 이어하기용 보상형 광고를 띄운다. 결과는 SkyGoal.onRewardResult 로 돌려준다. */
    @JavascriptInterface
    public void showRewarded() {
        ads.showRewarded();
    }
}
