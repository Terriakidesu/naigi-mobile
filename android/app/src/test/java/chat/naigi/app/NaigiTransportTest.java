package chat.naigi.app;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

/**
 * Exercises the app's API transport against a real HTTP server on the JVM, so the
 * request path is verified without an emulator or a device.
 */
public class NaigiTransportTest {

    private StubServer server;
    private String origin;

    private static byte[] utf8(String value) {
        return value.getBytes(StandardCharsets.UTF_8);
    }

    private static String text(byte[] value) {
        return new String(value, StandardCharsets.UTF_8);
    }

    private static StubServer.Reply json(int status, String body) {
        return new StubServer.Reply(status, "application/json", utf8(body));
    }

    @Before
    public void startServer() throws IOException {
        server = new StubServer();
        origin = server.origin();
        server.handle(request -> {
            switch (request.path) {
                case "/v1/version":
                    return json(200, "{\"name\":\"Naigi\",\"version\":\"0.26.0\"}");
                case "/v1/auth/login":
                    return json(200, "{\"user\":{\"id\":\"u1\"}}")
                        .header("Set-Cookie", "privchat_session=abc123; Path=/; HttpOnly");
                case "/v1/crypto/keys/upload":
                    return new StubServer.Reply(204, null, new byte[0]);
                case "/v1/attachment": {
                    byte[] payload = new byte[256];
                    for (int index = 0; index < payload.length; index += 1) payload[index] = (byte) index;
                    return new StubServer.Reply(200, "application/octet-stream", payload);
                }
                case "/v1/missing":
                    return json(404, "{\"error\":\"not_found\"}");
                case "/v1/boom":
                    return json(500, "{\"error\":\"internal\"}");
                case "/v1/redirect":
                    return new StubServer.Reply(302, null, new byte[0])
                        .header("Location", "https://elsewhere.example.com/v1/me");
                default:
                    return json(404, "{\"error\":\"not_found\"}");
            }
        });
    }

    @After
    public void stopServer() {
        server.close();
    }

    @Test
    public void readsAJsonResponseFromTheSelectedServer() throws Exception {
        NaigiTransport.Result result = NaigiTransport.request(origin + "/v1/version", "GET", null, null, null);
        assertEquals(200, result.status);
        assertEquals("{\"name\":\"Naigi\",\"version\":\"0.26.0\"}", text(result.body));
        assertTrue(result.headers.get("Content-Type").contains("application/json"));
        assertEquals(List.of("GET"), server.requests().stream().map(request -> request.method).toList());
    }

    @Test
    public void deliversAJsonBodyUnchanged() throws Exception {
        String body = "{\"username\":\"terriakidesu\",\"password\":\"s3cret\"}";
        NaigiTransport.Result result = NaigiTransport.request(
            origin + "/v1/auth/login", "POST",
            Map.of("content-type", "application/json", "accept", "application/json"),
            NaigiTransport.encodeBody(utf8(body)), null);
        assertEquals(200, result.status);
        assertEquals(1, server.requests().size());
        assertEquals(body, text(server.requests().get(0).body));
    }

    @Test
    public void returnsBinaryBodiesByteForByte() throws Exception {
        NaigiTransport.Result result = NaigiTransport.request(origin + "/v1/attachment", "GET", null, null, null);
        assertEquals(200, result.status);
        byte[] expected = new byte[256];
        for (int index = 0; index < 256; index += 1) expected[index] = (byte) index;
        assertArrayEquals(expected, result.body);
    }

    @Test
    public void keepsTheQueryStringSoCursorsAndFiltersSurvive() throws Exception {
        NaigiTransport.request(origin + "/v1/messages?before=abc&limit=50", "GET", null, null, null);
        assertEquals("before=abc&limit=50", server.requests().get(0).query);
    }

    @Test
    public void carriesTheSessionCookieAndReportsTheServersOwn() throws Exception {
        NaigiTransport.Result result = NaigiTransport.request(
            origin + "/v1/auth/login", "POST", null, null, "privchat_session=existing");
        assertEquals("privchat_session=existing", server.requests().get(0).cookie);
        assertEquals(1, result.setCookies.size());
        assertTrue(result.setCookies.get(0).startsWith("privchat_session=abc123"));
    }

    @Test
    public void doesNotLeakTheServersSetCookieIntoTheBodyHeaders() throws Exception {
        NaigiTransport.Result result = NaigiTransport.request(origin + "/v1/auth/login", "POST", null, null, null);
        assertNull(result.headers.get("Set-Cookie"));
        assertNull(result.headers.get("set-cookie"));
    }

    @Test
    public void keepsUserHeadersAndDropsTheOnesThePlatformOwns() throws Exception {
        byte[] payload = utf8("{\"a\":1}");
        NaigiTransport.request(
            origin + "/v1/crypto/keys/upload", "PUT",
            Map.of("content-type", "application/json", "host", "localhost", "content-length", "999", "accept-encoding", "gzip"),
            NaigiTransport.encodeBody(payload), null);
        StubServer.Recorded seen = server.requests().get(0);
        String headers = seen.header.toLowerCase(java.util.Locale.ROOT);
        assertTrue(headers.contains("content-type: application/json"));
        // Our forged values must not survive; the Host line below can only be
        // the platform's own, which always carries the real authority.
        assertFalse(headers.contains("content-length: 999"));
        assertFalse(seen.header.contains("localhost"));
        assertFalse(headers.contains("accept-encoding: gzip"));
        assertEquals(payload.length, seen.body.length);
    }

    @Test
    public void anEmptyResponseStaysEmpty() throws Exception {
        NaigiTransport.Result result = NaigiTransport.request(
            origin + "/v1/crypto/keys/upload", "POST", null, NaigiTransport.encodeBody(utf8("{}")), null);
        assertEquals(204, result.status);
        assertEquals(0, result.body.length);
    }

    @Test
    public void errorStatusesAndBodiesArePassedThrough() throws Exception {
        NaigiTransport.Result missing = NaigiTransport.request(origin + "/v1/missing", "GET", null, null, null);
        assertEquals(404, missing.status);
        assertTrue(text(missing.body).contains("not_found"));
        NaigiTransport.Result boom = NaigiTransport.request(origin + "/v1/boom", "GET", null, null, null);
        assertEquals(500, boom.status);
        assertTrue(text(boom.body).contains("internal"));
    }

    @Test
    public void aRedirectIsNotFollowedSilently() throws Exception {
        NaigiTransport.Result result = NaigiTransport.request(origin + "/v1/redirect", "GET", null, null, null);
        assertEquals(302, result.status);
        assertEquals("https://elsewhere.example.com/v1/me", result.headers.get("Location"));
    }

    @Test
    public void onlyTheSelectedServerIsReachable() {
        assertTrue(NaigiTransport.isAllowedUrl("https://chat.example.com/v1/me", "https://chat.example.com"));
        assertTrue(NaigiTransport.isAllowedUrl("http://127.0.0.1:8080/v1/me", "http://127.0.0.1:8080"));
        assertTrue(NaigiTransport.isAllowedUrl("http://localhost:3000/v1/me", "http://localhost:3000"));

        // A different server, even on the same host.
        assertFalse(NaigiTransport.isAllowedUrl("https://evil.example.com/v1/me", "https://chat.example.com"));
        assertFalse(NaigiTransport.isAllowedUrl("https://chat.example.com:8443/v1/me", "https://chat.example.com"));
        // Downgrade attempts and look-alike hosts.
        assertFalse(NaigiTransport.isAllowedUrl("http://chat.example.com/v1/me", "https://chat.example.com"));
        assertFalse(NaigiTransport.isAllowedUrl("https://chat.example.com.evil.test/v1/me", "https://chat.example.com"));
        // Plain http to a remote host is never allowed.
        assertFalse(NaigiTransport.isAllowedUrl("http://192.168.1.10:3000/v1/me", "http://192.168.1.10:3000"));
        // Credentials in the address.
        assertFalse(NaigiTransport.isAllowedUrl("https://u:p@chat.example.com/v1/me", "https://chat.example.com"));
        // No server selected, or nonsense input.
        assertFalse(NaigiTransport.isAllowedUrl("https://chat.example.com/v1/me", null));
        assertFalse(NaigiTransport.isAllowedUrl("https://chat.example.com/v1/me", ""));
        assertFalse(NaigiTransport.isAllowedUrl(null, "https://chat.example.com"));
        assertFalse(NaigiTransport.isAllowedUrl("not a url", "https://chat.example.com"));
    }

    @Test
    public void anUnreachableServerFailsInsteadOfHanging() {
        try {
            NaigiTransport.request("http://127.0.0.1:1/v1/me", "GET", null, null, null);
            fail("expected an IOException");
        } catch (IOException expected) {
            assertTrue(expected instanceof java.net.ConnectException || expected.getMessage() != null);
        }
    }

    @Test
    public void aMalformedBodyIsRejectedBeforeAnyRequest() {
        try {
            NaigiTransport.request(origin + "/v1/me", "POST", null, "not base64!!", null);
            fail("expected an IllegalArgumentException");
        } catch (IllegalArgumentException expected) {
            assertEquals("invalid_request_body", expected.getMessage());
        } catch (IOException error) {
            fail("should not have reached the network: " + error);
        }
        assertEquals(0, server.requests().size());
    }

    @Test
    public void base64RoundTripsBinaryExactly() {
        byte[] payload = new byte[512];
        for (int index = 0; index < payload.length; index += 1) payload[index] = (byte) (index * 7);
        assertArrayEquals(payload, Base64.getDecoder().decode(NaigiTransport.encodeBody(payload)));
        assertArrayEquals(new byte[0], NaigiTransport.decodeBody(""));
        assertArrayEquals(new byte[0], NaigiTransport.decodeBody(null));
    }

    @Test
    public void platformOwnedHeadersAreRecognised() {
        assertFalse(NaigiTransport.isForwardableHeader("Host"));
        assertFalse(NaigiTransport.isForwardableHeader("content-length"));
        assertFalse(NaigiTransport.isForwardableHeader("Accept-Encoding"));
        assertFalse(NaigiTransport.isForwardableHeader("Origin"));
        assertTrue(NaigiTransport.isForwardableHeader("content-type"));
        assertTrue(NaigiTransport.isForwardableHeader("Authorization"));
        assertTrue(NaigiTransport.isForwardableHeader("X-Custom"));
    }

    @Test
    public void verificationAcceptsOnlyCleanOrigins() {
        assertTrue(NaigiTransport.isVerifiableOrigin("https://chat.example.com"));
        assertTrue(NaigiTransport.isVerifiableOrigin("https://chat.example.com/"));
        assertTrue(NaigiTransport.isVerifiableOrigin("https://naigi.home.arpa"));
        assertTrue(NaigiTransport.isVerifiableOrigin("http://127.0.0.1:3000"));
        assertTrue(NaigiTransport.isVerifiableOrigin("http://localhost/"));

        assertFalse(NaigiTransport.isVerifiableOrigin("http://chat.example.com"));
        assertFalse(NaigiTransport.isVerifiableOrigin("http://192.168.1.10:3000"));
        assertFalse(NaigiTransport.isVerifiableOrigin("https://user:pass@chat.example.com"));
        assertFalse(NaigiTransport.isVerifiableOrigin("https://chat.example.com/v1"));
        assertFalse(NaigiTransport.isVerifiableOrigin("https://chat.example.com?x=1"));
        assertFalse(NaigiTransport.isVerifiableOrigin("https://chat.example.com#frag"));
        assertFalse(NaigiTransport.isVerifiableOrigin("ftp://chat.example.com"));
        assertFalse(NaigiTransport.isVerifiableOrigin(null));
        assertFalse(NaigiTransport.isVerifiableOrigin("not a url"));
        assertFalse(NaigiTransport.isVerifiableOrigin(""));
    }

    @Test
    public void failuresAreClassifiedForThePicker() {
        assertEquals("dns_failed", NaigiTransport.errorCode(new java.net.UnknownHostException("x")));
        assertEquals("tls_failed", NaigiTransport.errorCode(new javax.net.ssl.SSLHandshakeException("x")));
        assertEquals("tls_failed", NaigiTransport.errorCode(new javax.net.ssl.SSLException("x")));
        assertEquals("connect_failed", NaigiTransport.errorCode(new java.net.ConnectException("x")));
        assertEquals("connect_failed", NaigiTransport.errorCode(new java.net.SocketTimeoutException("x")));
        assertEquals("request_too_large", NaigiTransport.errorCode(new IllegalArgumentException("request_too_large")));
        assertEquals("invalid_request_body", NaigiTransport.errorCode(new IllegalArgumentException("invalid_request_body")));
        assertEquals("naigi_request_failed", NaigiTransport.errorCode(new IllegalArgumentException("something else")));
        assertEquals("naigi_request_failed", NaigiTransport.errorCode(new java.io.IOException("x")));
    }
}
