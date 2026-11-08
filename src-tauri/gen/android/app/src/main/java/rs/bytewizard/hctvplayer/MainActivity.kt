package rs.bytewizard.hctvplayer

import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    allowRemoteMediaPlayback()
  }

  override fun onResume() {
    super.onResume()
    allowRemoteMediaPlayback()
  }

  private fun findWebView(view: View): WebView? {
    if (view is WebView) return view
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) {
        val found = findWebView(view.getChildAt(i))
        if (found != null) return found
      }
    }
    return null
  }

  private fun allowRemoteMediaPlayback() {
    // Backend-triggered media must start without a second local remote gesture.
    window.decorView.post {
      findWebView(window.decorView)?.settings?.mediaPlaybackRequiresUserGesture = false
    }
  }
}
