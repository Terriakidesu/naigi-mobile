package chat.naigi.app;

import android.webkit.CookieManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Iterator;

/**
 * Sends the bundled page's /v1 calls to the selected Naigi server.
 *
 * All the request work lives in {@link NaigiTransport}, which has no Android
 * dependencies and is unit tested on a plain JVM. This class only moves values
 * across the bridge and keeps the session cookie in the WebView's cookie store,
 * which is shared with the app's own requests.
 */
@CapacitorPlugin(name = "NaigiApi")
public class NaigiApiPlugin extends Plugin {

    @PluginMethod
    public void request(PluginCall call) {
        String url = call.getString("url");
        String method = call.getString("method", "GET");
        JSObject headers = call.getObject("headers", new JSObject());
        String body = call.getString("body");

        if (!NaigiTransport.isAllowedUrl(url, NaigiServerPlugin.activeOrigin(getContext()))) {
            call.reject("invalid_naigi_url");
            return;
        }

        try {
            java.util.Map<String, String> outgoing = new java.util.LinkedHashMap<>();
            Iterator<String> names = headers.keys();
            while (names.hasNext()) {
                String name = names.next();
                String value = headers.optString(name, null);
                if (value != null) outgoing.put(name, value);
            }

            String cookies = CookieManager.getInstance().getCookie(url);
            NaigiTransport.Result result = NaigiTransport.request(url, method, outgoing, body, cookies);

            // Session cookies must go back where the WebView will send them next time.
            for (String cookie : result.setCookies) {
                CookieManager.getInstance().setCookie(url, cookie);
            }

            JSObject responseHeaders = new JSObject();
            for (java.util.Map.Entry<String, String> header : result.headers.entrySet()) {
                responseHeaders.put(header.getKey(), header.getValue());
            }

            JSObject response = new JSObject();
            response.put("status", result.status);
            response.put("url", result.url);
            response.put("headers", responseHeaders);
            response.put("body", NaigiTransport.encodeBody(result.body));
            call.resolve(response);
        } catch (IllegalArgumentException error) {
            call.reject(NaigiTransport.errorCode(error));
        } catch (Exception error) {
            call.reject(NaigiTransport.errorCode(error), error);
        }
    }
}
