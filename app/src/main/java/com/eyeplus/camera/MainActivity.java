package com.eyeplus.camera;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStreamWriter;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

public class MainActivity extends Activity {
    private static final String TAG = "EyePlus";
    private static final int PERMISSION_REQUEST = 100;
    private static final int FILE_CHOOSER_REQUEST = 101;
    private WebView webView;
    private ValueCallback<Uri[]> fileUploadCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN
        );
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        setContentView(R.layout.activity_main);

        createNotificationChannel();
        requestPermissions();

        webView = findViewById(R.id.webview);
        setupWebView();
        webView.loadUrl("file:///android_asset/index.html");
    }

    private void setupWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        webView.addJavascriptInterface(new NativeBridge(), "NativeBridge");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (url.startsWith("http://") || url.startsWith("https://")) {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    startActivity(intent);
                    return true;
                }
                return false;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage msg) {
                Log.d(TAG, "JS: " + msg.message());
                return true;
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.grant(request.getResources());
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback,
                                             FileChooserParams fileChooserParams) {
                if (fileUploadCallback != null) {
                    fileUploadCallback.onReceiveValue(null);
                }
                fileUploadCallback = callback;
                Intent intent = fileChooserParams.createIntent();
                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                } catch (Exception e) {
                    fileUploadCallback = null;
                    return false;
                }
                return true;
            }
        });
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                "eyeplus_motion",
                "Motion Alerts",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Notifikace pri detekci pohybu");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private void requestPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            String[] perms = {
                Manifest.permission.CAMERA,
                Manifest.permission.RECORD_AUDIO,
                Manifest.permission.INTERNET,
                Manifest.permission.ACCESS_NETWORK_STATE,
                Manifest.permission.ACCESS_WIFI_STATE,
                Manifest.permission.WRITE_EXTERNAL_STORAGE,
                Manifest.permission.READ_EXTERNAL_STORAGE,
                Manifest.permission.FOREGROUND_SERVICE,
            };
            boolean needed = false;
            for (String p : perms) {
                if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) {
                    needed = true;
                    break;
                }
            }
            if (needed) {
                requestPermissions(perms, PERMISSION_REQUEST);
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (fileUploadCallback != null) {
                Uri[] results = null;
                if (resultCode == RESULT_OK && data != null) {
                    results = new Uri[]{data.getData()};
                }
                fileUploadCallback.onReceiveValue(results);
                fileUploadCallback = null;
            }
        }
    }

    class NativeBridge {
        private final ExecutorService httpPool = Executors.newFixedThreadPool(4);

        @JavascriptInterface
        public void httpGet(String urlString, int timeoutMs, String callbackId) {
            httpPool.execute(() -> {
                try {
                    URL url = new URL(urlString);
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setConnectTimeout(timeoutMs > 0 ? timeoutMs : 3000);
                    conn.setReadTimeout(timeoutMs > 0 ? timeoutMs : 5000);
                    conn.setRequestMethod("GET");
                    conn.setDoInput(true);
                    int code = conn.getResponseCode();
                    String contentType = conn.getContentType();
                    InputStream is = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
                    ByteArrayOutputStream baos = new ByteArrayOutputStream();
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = is.read(buf)) != -1) baos.write(buf, 0, n);
                    is.close();
                    String b64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);
                    String json = "{\"status\":" + code + ",\"type\":\"" + (contentType != null ? contentType.replace("\"", "\\\"") : "") + "\",\"body\":\"" + b64 + "\"}";
                    callJs("_httpCallback('" + callbackId + "', " + json + ")");
                } catch (Exception e) {
                    String err = e.getClass().getSimpleName() + ": " + e.getMessage();
                    callJs("_httpCallback('" + callbackId + "', {status:0,error:\"" + err.replace("\"", "\\\"").replace("\n", " ") + "\"})");
                }
            });
        }

        @JavascriptInterface
        public void httpPost(String urlString, String bodyJson, int timeoutMs, String callbackId) {
            httpPool.execute(() -> {
                try {
                    URL url = new URL(urlString);
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setConnectTimeout(timeoutMs > 0 ? timeoutMs : 3000);
                    conn.setReadTimeout(timeoutMs > 0 ? timeoutMs : 5000);
                    conn.setRequestMethod("POST");
                    conn.setDoOutput(true);
                    conn.setRequestProperty("Content-Type", "application/json");
                    if (bodyJson != null && !bodyJson.isEmpty()) {
                        OutputStreamWriter writer = new OutputStreamWriter(conn.getOutputStream());
                        writer.write(bodyJson);
                        writer.flush();
                        writer.close();
                    }
                    int code = conn.getResponseCode();
                    InputStream is = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
                    ByteArrayOutputStream baos = new ByteArrayOutputStream();
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = is.read(buf)) != -1) baos.write(buf, 0, n);
                    is.close();
                    String b64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);
                    String json = "{\"status\":" + code + ",\"body\":\"" + b64 + "\"}";
                    callJs("_httpCallback('" + callbackId + "', " + json + ")");
                } catch (Exception e) {
                    String err = e.getClass().getSimpleName() + ": " + e.getMessage();
                    callJs("_httpCallback('" + callbackId + "', {status:0,error:\"" + err.replace("\"", "\\\"").replace("\n", " ") + "\"})");
                }
            });
        }

        @JavascriptInterface
        public void scanNetwork(final String callbackId) {
            new Thread(() -> {
                try {
                    String localIp = getLocalIpV4();
                    String subnet = localIp != null && localIp.contains(".") ? localIp.substring(0, localIp.lastIndexOf('.') + 1) : "192.168.1.";
                    final List<String> found = Collections.synchronizedList(new ArrayList<>());
                    final AtomicInteger done = new AtomicInteger(0);

                    for (int i = 1; i <= 254; i++) {
                        final String ip = subnet + i;
                        httpPool.execute(() -> {
                            try {
                                checkCameraAtIp(ip, found);
                            } catch (Exception ignored) {}
                            done.incrementAndGet();
                        });
                    }

                    long deadline = System.currentTimeMillis() + 35000;
                    while (done.get() < 254 && System.currentTimeMillis() < deadline) {
                        try { Thread.sleep(200); } catch (InterruptedException ignored) { break; }
                    }

                    StringBuilder json = new StringBuilder("[");
                    for (int i = 0; i < found.size(); i++) {
                        if (i > 0) json.append(",");
                        json.append(found.get(i));
                    }
                    json.append("]");
                    callJs("_httpCallback('" + callbackId + "', {status:1,body:\"" + json.toString().replace("\"", "\\\"") + "\"})");
                } catch (Exception e) {
                    callJs("_httpCallback('" + callbackId + "', {status:0,error:\"" + e.getMessage().replace("\"", "\\\"") + "\"})");
                }
            }).start();
        }

        private void checkCameraAtIp(String ip, List<String> found) {
            int[] ports = {80, 8080, 554};
            for (int port : ports) {
                try {
                    URL url = new URL("http://" + ip + ":" + port + "/");
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setConnectTimeout(400);
                    conn.setReadTimeout(400);
                    conn.setRequestMethod("GET");
                    int code = conn.getResponseCode();
                    if (code == 200 || code == 401 || code == 302 || code == 301) {
                        String probeUrl = "http://admin:admin@" + ip + ":" + port + "/cgi-bin/snapshot.cgi";
                        boolean hasSnapshot = false;
                        try {
                            URL snapUrl = new URL(probeUrl);
                            HttpURLConnection snapConn = (HttpURLConnection) snapUrl.openConnection();
                            snapConn.setConnectTimeout(400);
                            snapConn.setReadTimeout(400);
                            snapConn.setRequestMethod("GET");
                            if (snapConn.getResponseCode() == 200) hasSnapshot = true;
                        } catch (Exception ignored) {}

                        found.add("{\"ip\":\"" + ip + "\",\"port\":" + port + ",\"name\":\"Kamera na " + ip + "\",\"auth\":\"admin:admin\",\"snapshot\":" + hasSnapshot + "}");
                        return;
                    }
                } catch (Exception ignored) {}
            }
        }

        private String getLocalIpV4() {
            try {
                for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                    if (ni.isLoopback() || !ni.isUp()) continue;
                    for (InetAddress addr : Collections.list(ni.getInetAddresses())) {
                        if (!(addr instanceof java.net.Inet4Address) || addr.isLoopbackAddress()) continue;
                        String ip = addr.getHostAddress();
                        if (ip != null) return ip;
                    }
                }
            } catch (Exception ignored) {}
            return "192.168.1";
        }

        private void callJs(final String script) {
            webView.post(() -> webView.evaluateJavascript(script, null));
        }

        @JavascriptInterface
        public void showToast(String message) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show());
        }

        @JavascriptInterface
        public void saveImage(String base64Data, String filename) {
            try {
                byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES);
                dir.mkdirs();
                File file = new File(dir, filename);
                FileOutputStream fos = new FileOutputStream(file);
                fos.write(bytes);
                fos.close();

                MediaStore.Images.Media.insertImage(getContentResolver(), file.getAbsolutePath(),
                    filename, "EYEPLUS Snapshot");

                runOnUiThread(() -> Toast.makeText(MainActivity.this,
                    "Ulozeno: " + file.getAbsolutePath(), Toast.LENGTH_SHORT).show());
            } catch (Exception e) {
                Log.e(TAG, "Save image failed", e);
            }
        }

        @JavascriptInterface
        public void saveRecording(String base64Data, String filename) {
            try {
                byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES);
                dir.mkdirs();
                File file = new File(dir, filename);
                FileOutputStream fos = new FileOutputStream(file);
                fos.write(bytes);
                fos.close();
                runOnUiThread(() -> Toast.makeText(MainActivity.this,
                    "Zaznam ulozen: " + file.getAbsolutePath(), Toast.LENGTH_SHORT).show());
            } catch (Exception e) {
                Log.e(TAG, "Save recording failed", e);
            }
        }

        @JavascriptInterface
        public String getDeviceId() {
            return Build.MANUFACTURER + " " + Build.MODEL;
        }

        @JavascriptInterface
        public boolean isNativeApp() {
            return true;
        }
    }
}
