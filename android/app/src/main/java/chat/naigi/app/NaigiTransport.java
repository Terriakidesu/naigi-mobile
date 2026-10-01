package chat.naigi.app;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * The app's API transport, with no Android dependencies so it can be tested on a
 * plain JVM.
 *
 * The bundled pages address /v1 on the app's own origin, which is a local scheme
 * no server answers. This performs those calls for the selected server instead:
 * bodies travel as base64 so encrypted attachments survive the bridge, and
 * cookies are passed in and returned so the caller can keep them in the platform
 * cookie store.
 */
public final class NaigiTransport {

    public static final int MAX_BODY_BYTES = 64 * 1024 * 1024;

    private static final String[] HOP_BY_HOP = {
        "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
        "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length",
        "origin", "referer", "accept-encoding"
    };

    /** A response, ready to hand back to the page. */
    public static final class Result {
        public final int status;
        public final String url;
        public final Map<String, String> headers;
        public final byte[] body;
        public final List<String> setCookies;

        Result(int status, String url, Map<String, String> headers, byte[] body, List<String> setCookies) {
            this.status = status;
            this.url = url;
            this.headers = headers;
            this.body = body;
            this.setCookies = setCookies;
        }
    }

    private NaigiTransport() {}

    /**
     * Only the selected server may be contacted, and only over https, except for
     * a server on the device itself.
     */
    public static boolean isAllowedUrl(String rawUrl, String activeOrigin) {
        if (rawUrl == null || activeOrigin == null || activeOrigin.isBlank()) return false;
        try {
            URL parsed = new URL(rawUrl);
            String protocol = parsed.getProtocol().toLowerCase(Locale.ROOT);
            boolean allowedProtocol = protocol.equals("https")
                || (protocol.equals("http") && isLoopback(parsed.getHost()));
            if (!allowedProtocol) return false;
            if (parsed.getUserInfo() != null) return false;
            return activeOrigin.equals(parsed.getProtocol() + "://" + parsed.getAuthority());
        } catch (Exception error) {
            return false;
        }
    }

    static boolean isLoopback(String host) {
        if (host == null) return false;
        return host.equals("127.0.0.1") || host.equals("localhost") || host.equals("[::1]") || host.equals("::1");
    }

    /** Headers the platform manages itself must not be forwarded. */
    public static boolean isForwardableHeader(String name) {
        String lower = name.toLowerCase(Locale.ROOT);
        for (String hop : HOP_BY_HOP) if (lower.equals(hop)) return false;
        return true;
    }

    public static byte[] decodeBody(String base64) {
        if (base64 == null || base64.isEmpty()) return new byte[0];
        try {
            return Base64.getDecoder().decode(base64);
        } catch (IllegalArgumentException error) {
            throw new IllegalArgumentException("invalid_request_body");
        }
    }

    public static String encodeBody(byte[] payload) {
        return Base64.getEncoder().encodeToString(payload == null ? new byte[0] : payload);
    }

    public static byte[] utf8(String value) {
        return value.getBytes(StandardCharsets.UTF_8);
    }

    /**
     * Performs one API call.
     *
     * @param cookies cookies the caller already holds for this origin, or null
     * @throws IllegalArgumentException when the request is not allowed or is too large
     * @throws java.io.IOException when the server cannot be reached
     */
    public static Result request(
        String url,
        String method,
        Map<String, String> headers,
        String bodyBase64,
        String cookies
    ) throws java.io.IOException {
        byte[] payload = decodeBody(bodyBase64);
        if (payload.length > MAX_BODY_BYTES) throw new IllegalArgumentException("request_too_large");

        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        try {
            connection.setRequestMethod(method == null ? "GET" : method.toUpperCase(Locale.ROOT));
            connection.setInstanceFollowRedirects(false);
            connection.setUseCaches(false);
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(30_000);
            if (headers != null) {
                for (Map.Entry<String, String> header : headers.entrySet()) {
                    if (header.getValue() != null && isForwardableHeader(header.getKey())) {
                        connection.setRequestProperty(header.getKey(), header.getValue());
                    }
                }
            }
            if (cookies != null && !cookies.isBlank()) connection.setRequestProperty("Cookie", cookies);

            if (payload.length > 0 && !connection.getRequestMethod().equals("GET") && !connection.getRequestMethod().equals("HEAD")) {
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(payload.length);
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(payload);
                }
            }

            int status = connection.getResponseCode();
            byte[] body = readAll(status >= 400 ? connection.getErrorStream() : connection.getInputStream());

            Map<String, String> out = new LinkedHashMap<>();
            List<String> setCookies = new ArrayList<>();
            for (Map.Entry<String, List<String>> entry : connection.getHeaderFields().entrySet()) {
                String name = entry.getKey();
                List<String> values = entry.getValue();
                if (name == null || values == null || values.isEmpty()) continue;
                if (name.equalsIgnoreCase("set-cookie")) {
                    setCookies.addAll(values);
                    continue;
                }
                if (isForwardableHeader(name)) out.put(name, String.join(", ", values));
            }
            return new Result(status, url, out, body, setCookies);
        } finally {
            connection.disconnect();
        }
    }

    private static byte[] readAll(InputStream stream) throws java.io.IOException {
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
}
