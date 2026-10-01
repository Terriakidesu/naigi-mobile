package chat.naigi.app;

import android.Manifest;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.List;

/**
 * Reports and requests the runtime permissions Naigi needs, so the interface can
 * ask for one at the moment a feature is used and explain a refusal.
 *
 * Nothing is requested at launch: signing in and browsing conversations work with
 * no permissions at all. Microphone, camera, Bluetooth, and notification access are
 * only requested by the feature that needs them.
 */
@CapacitorPlugin(
    name = "NaigiPermissions",
    permissions = {
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO, Manifest.permission.MODIFY_AUDIO_SETTINGS }),
        @Permission(alias = "camera", strings = { Manifest.permission.CAMERA }),
        @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_CONNECT }),
        @Permission(
            alias = "notifications",
            strings = { Manifest.permission.POST_NOTIFICATIONS }
        )
    }
)
public class NaigiPermissionsPlugin extends Plugin {

    private static final String[] ALIASES = { "microphone", "camera", "bluetooth", "notifications" };

    /** Permission groups that only exist on newer Android releases. */
    private static boolean isSupported(String alias) {
        return !"notifications".equals(alias) || Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU;
    }

    /** Reads the declared permissions from the annotation so both stay in sync. */
    private List<String> permissionStrings(String alias) {
        for (Permission info : getPluginHandle().getPluginAnnotation().permissions()) {
            if (alias.equals(info.alias())) return new ArrayList<>(List.of(info.strings()));
        }
        return new ArrayList<>();
    }

    private JSObject describe(String alias) {
        boolean supported = isSupported(alias);
        PermissionState state = supported ? getPermissionState(alias) : PermissionState.GRANTED;
        JSObject result = new JSObject();
        result.put("alias", alias);
        result.put("supported", supported);
        result.put("granted", state == PermissionState.GRANTED);
        // Capacitor remembers a permanent refusal, which the interface must send to system settings.
        result.put("blocked", state == PermissionState.DENIED);
        result.put("prompt", state == PermissionState.PROMPT);
        return result;
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject permissions = new JSObject();
        for (String alias : ALIASES) permissions.put(alias, describe(alias));
        JSObject result = new JSObject();
        result.put("permissions", permissions);
        call.resolve(result);
    }

    @PluginMethod
    public void request(PluginCall call) {
        String alias = call.getString("alias");
        if (alias == null || permissionStrings(alias).isEmpty()) {
            call.reject("unknown_permission_alias");
            return;
        }
        if (!isSupported(alias) || getPermissionState(alias) == PermissionState.GRANTED) {
            call.resolve(describe(alias));
            return;
        }
        requestPermissionForAlias(alias, call, "permissionResult");
    }

    @PermissionCallback
    private void permissionResult(PluginCall call) {
        call.resolve(describe(call.getString("alias", "microphone")));
    }
}
