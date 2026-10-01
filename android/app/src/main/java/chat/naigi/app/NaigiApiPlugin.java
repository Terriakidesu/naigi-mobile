package chat.naigi.app;

import android.webkit.CookieManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Performs the app's API calls natively.
 *
 * The bundled pages address /v1 on their own origin, which is a local scheme that
 * no server answers. Routing those requests through the platform instead keeps
 * session cookies in the shared cookie store and avoids depending on the server
 * allowing cross-origin requests.
 *
 * Bodies cross the bridge as base64 so encrypted attachments work in both
 * directions without a multipart rebuild.
 */
@CapacitorPlugin(name = "NaigiApi")
public class NaigiApiPlugin extends Plugin {

    private static final int MAX_BODY_BYTES = 64 * 1024 * 1024;
    private static final String[] HOP_BY_HOP = {
        "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
        "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length",
        "origin", "referer", "accept-encoding"
    };

    @PluginMethod
    public void request(PluginCall call) {
        String rawUrl = call.getString("url");
        String method = call.getString("method", "GET");
        JSObject headers = call.getObject("headers", new JSObject());
        String body = call.getString("body");

        if (rawUrl == null || !isAllowed(rawUrl)) {
            call.reject("invalid_naigi_url");
            return;
        }

        HttpURLConnection connection = null;
        try {
            URL target = new URL(rawUrl);
            connection = (HttpURLConnection) target.openConnection();
            connection.setRequestMethod(method);
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(30_000);
            connection.setUseCaches(false);

            java.util.Iterator<String> names = headers.keys();
            while (names.hasNext()) {
                String name = names.next();
                if (!isForwardable(name)) continue;
                String value = headers.optString(name, null);
                if (value != null) connection.setRequestProperty(name, value);
            }
            // The session cookie lives in the WebView's cookie store; forward it and
            // let Set-Cookie land back in the same place.
            String cookies = CookieManager.getInstance().getCookie(rawUrl);
            if (cookies != null && !cookies.isEmpty()) connection.setRequestProperty("Cookie", cookies);

            if (body != null && !body.isEmpty() && !method.equals("GET") && !method.equals("HEAD")) {
                byte[] payload = Base64.getDecoder().decode(body);
                if (payload.length > MAX_BODY_BYTES) {
                    call.reject("request_too_large");
                    return;
                }
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(payload.length);
                try (java.io.OutputStream output = connection.getOutputStream()) {
                    output.write(payload);
                }
            }

            int status = connection.getResponseCode();
            byte[] payload = readAll(status >= 400 ? connection.getErrorStream() : connection.getInputStream());

            JSObject responseHeaders = new JSObject();
            for (Map.Entry<String, List<String>> entry : connection.getHeaderFields().entrySet()) {
                String name = entry.getKey();
                List<String> values = entry.getValue();
                if (name == null || values == null || values.isEmpty()) continue;
                if (name.equalsIgnoreCase("set-cookie")) {
                    for (String value : values) CookieManager.getInstance().setCookie(rawUrl, value);
                    continue;
                }
                if (isForwardable(name)) responseHeaders.put(name, String.join(", ", values));
            }

            JSObject result = new JSObject();
            result.put("status", status);
            result.put("url", rawUrl);
            result.put("headers", responseHeaders);
            result.put("body", Base64.getEncoder().encodeToString(payload));
            call.resolve(result);
        } catch (IllegalArgumentException error) {
            call.reject("invalid_naigi_request");
        } catch (Exception error) {
            call.reject("naigi_request_failed", error);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    /** Only https origins, and only those the user actually saved. */
    private boolean isAllowed(String url) {
        try {
            URL parsed = new URL(url);
            String protocol = parsed.getProtocol().toLowerCase(Locale.ROOT);
            boolean allowedProtocol = protocol.equals("https")
                || (protocol.equals("http") && isLoopback(parsed.getHost()));
            if (!allowedProtocol || parsed.getUserInfo() != null) return false;
            String active = NaigiServerPlugin.activeOrigin(getContext());
            return active != null && active.equals(parsed.getProtocol() + "://" + parsed.getAuthority());
        } catch (Exception error) {
            return false;
        }
    }

    private static boolean isLoopback(String host) {
        return host.equals("127.0.0.1") || host.equals("localhost") || host.equals("[::1]") || host.equals("::1");
    }

    private static boolean isForwardable(String name) {
        String lower = name.toLowerCase(Locale.ROOT);
        for (String hop : HOP_BY_HOP) if (lower.equals(hop)) return false;
        return true;
    }

    private static byte[] readAll(InputStream stream) throws Exception {
        if (stream == null) return new byte[0];
        try (InputStream input = stream) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
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

    static byte[] utf8(String value) {
        return value.getBytes(StandardCharsets.UTF_8);
    }

    static InputStream stream(byte[] payload) {
        return new ByteArrayInputStream(payload);
    }
}
