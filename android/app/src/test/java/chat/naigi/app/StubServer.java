package chat.naigi.app;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * A minimal loopback HTTP/1.1 server for tests, built on plain sockets so it
 * needs nothing beyond the JDK and is not shadowed by the Android classpath.
 *
 * Handles one request per connection and always closes, which is all
 * {@link NaigiTransport} needs.
 */
final class StubServer implements AutoCloseable {

    /** One recorded request. */
    static final class Recorded {
        final String method;
        final String path;
        final String query;
        final byte[] body;
        final String cookie;
        final String header;

        Recorded(String method, String path, String query, byte[] body, String cookie, String header) {
            this.method = method;
            this.path = path;
            this.query = query;
            this.body = body;
            this.cookie = cookie;
            this.header = header;
        }
    }

    /** A canned response. */
    static final class Reply {
        final int status;
        final String contentType;
        final byte[] body;
        final List<String> extraHeaders = new ArrayList<>();

        Reply(int status, String contentType, byte[] body) {
            this.status = status;
            this.contentType = contentType;
            this.body = body;
        }

        Reply header(String name, String value) {
            extraHeaders.add(name + ": " + value);
            return this;
        }
    }

    interface Handler { Reply handle(Recorded request); }

    private final ServerSocket socket;
    private final Thread acceptor;
    private final List<Recorded> requests = new CopyOnWriteArrayList<>();
    private volatile Handler handler;
    private volatile boolean running = true;

    StubServer() throws IOException {
        socket = new ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"));
        acceptor = new Thread(this::acceptLoop, "stub-server");
        acceptor.setDaemon(true);
        acceptor.start();
    }

    String origin() {
        return "http://127.0.0.1:" + socket.getLocalPort();
    }

    List<Recorded> requests() {
        return requests;
    }

    void handle(Handler next) {
        this.handler = next;
    }

    private void acceptLoop() {
        while (running) {
            try (Socket client = socket.accept()) {
                serve(client);
            } catch (IOException error) {
                if (running) continue;
                return;
            }
        }
    }

    private void serve(Socket client) throws IOException {
        client.setSoTimeout(10_000);
        BufferedReader reader = new BufferedReader(new InputStreamReader(client.getInputStream(), StandardCharsets.ISO_8859_1));
        String requestLine = reader.readLine();
        if (requestLine == null) return;
        String[] parts = requestLine.split(" ");
        String method = parts.length > 0 ? parts[0] : "GET";
        String target = parts.length > 1 ? parts[1] : "/";

        String contentLength = "0";
        String cookie = null;
        StringBuilder headerLines = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null && !line.isEmpty()) {
            headerLines.append(line).append('\n');
            String lower = line.toLowerCase(Locale.ROOT);
            if (lower.startsWith("content-length:")) contentLength = line.substring(line.indexOf(':') + 1).trim();
            if (lower.startsWith("cookie:")) cookie = line.substring(line.indexOf(':') + 1).trim();
        }

        byte[] body = new byte[length];
        int read = 0;
        while (read < length) {
            // Read raw bytes: the BufferedReader would consume and buffer payload.
            int count = raw.read(body, read, length - read);
            if (count < 0) break;
            read += count;
        }

        String path = target;
        String query = "";
        int mark = target.indexOf('?');
        if (mark >= 0) { path = target.substring(0, mark); query = target.substring(mark + 1); }
        Recorded recorded = new Recorded(method, path, query, body, cookie, headerLines.toString());
        requests.add(recorded);

        Handler current = handler;
        Reply reply = current == null ? new Reply(404, null, new byte[0]) : current.handle(recorded);
        write(client.getOutputStream(), reply);
    }

    private static void write(OutputStream output, Reply reply) throws IOException {
        StringBuilder head = new StringBuilder();
        head.append("HTTP/1.1 ").append(reply.status).append(' ').append(reply.status == 204 ? "No Content" : "OK").append("\r\n");
        if (reply.contentType != null) head.append("Content-Type: ").append(reply.contentType).append("\r\n");
        for (String header : reply.extraHeaders) head.append(header).append("\r\n");
        boolean noBody = reply.status == 204 || reply.body.length == 0;
        if (!noBody) head.append("Content-Length: ").append(reply.body.length).append("\r\n");
        head.append("Connection: close\r\n\r\n");
        output.write(head.toString().getBytes(StandardCharsets.ISO_8859_1));
        if (!noBody) output.write(reply.body);
        output.flush();
    }

    @Override
    public void close() {
        running = false;
        try { socket.close(); } catch (IOException ignored) { /* shutting down */ }
        try { acceptor.join(2000); } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
    }
}
