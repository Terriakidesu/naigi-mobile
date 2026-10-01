package chat.naigi.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Remembers which Naigi server the app talks to.
 *
 * The bundled pages address /v1 on the app's own origin, so this value is the
 * single source of truth: the WebView client proxies those requests here, and
 * the page bridge mirrors it for the realtime socket.
 */
@CapacitorPlugin(name = "NaigiServer")
public class NaigiServerPlugin extends Plugin {

    public static final String PREFS = "naigi-mobile-servers";
    public static final String KEY_ACTIVE = "active";

    private static final int MAX_BODY_BYTES = 64 * 1024 * 1024;
    private static final String[] HOP_BY_HOP = {
        "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
        "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length", "origin", "referer"
    };

    static String activeOrigin(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_ACTIVE, null);
    }

    static void setActiveOrigin(Context context, String origin) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_ACTIVE, origin).apply();
    }

    @PluginMethod
    public void getActive(PluginCall call) {
        JSObject result = new JSObject();
        result.put("origin", activeOrigin(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void setServers(PluginCall call) {
        String active = call.getString("active");
        setActiveOrigin(getContext(), active);
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY_ACTIVE).apply();
        call.resolve();
    }

    private static String statusMessage(int status) {
        if (status == 401) return "Unauthorized";
        if (status == 403) return "Forbidden";
        if (status == 404) return "Not Found";
        if (status == 409) return "Conflict";
        if (status == 429) return "Too Many Requests";
        if (status >= 500) return "Server Error";
        return "OK";
    }

    private static byte[] readAll(InputStream stream) throws Exception {
        if (stream == null) return new byte[0];
        try (InputStream input = stream) {
            java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
            byte[] chunk = new byte[16 * 1024];
            int total = 0;
            int read;
            while ((read = input.read(chunk)) != -1) {
                total += read;
                if (total > MAX_BODY_BYTES) throw new IllegalStateException("response_too_large");
                buffer.write(chunk, 0, read);
            }
            return buffer.toByteArray();
        }
    }

    private static WebResourceResponse error(int status, String code, String message) {
        byte[] body = ("{\"code\":\"" + code + "\",\"message\":\"" + message + "\"}").getBytes(java.nio.charset.StandardCharsets.UTF_8);
        Map<String, String> headers = new java.util.LinkedHashMap<>();
        headers.put("Content-Type", "application/json; charset=utf-8");
        headers.put("Cache-Control", "no-store");
        return new WebResourceResponse("application/json", "utf-8", status, statusMessage(status), headers, new ByteArrayInputStream(body));
    }

    static List<String> storedServers(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String raw = prefs.getString("servers", "");
        List<String> servers = new ArrayList<>();
        for (String value : raw.split(",")) if (!value.isBlank()) servers.add(value.trim());
        return servers;
    }
}
