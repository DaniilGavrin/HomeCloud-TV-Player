package rs.bytewizard.hctvplayer

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  // Wry/Tauri 2 provides this hook at actual WebView creation time.
  // Configuring here is reliable even if the WebView is initialized after
  // onCreate/onResume. Remote media commands must not need a TV-remote click.
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webView.settings.mediaPlaybackRequiresUserGesture = false
  }
}
