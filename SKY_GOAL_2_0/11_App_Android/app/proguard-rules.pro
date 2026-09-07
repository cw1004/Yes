# WebView 에서 호출하는 JavaScript 인터페이스는 난독화하면 안 된다.
-keepclassmembers class com.skygoal.arcade.NativeBridge {
    public *;
}
-keepattributes JavascriptInterface
