package chat.naigi.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NaigiPermissionsPlugin.class);
        registerPlugin(NaigiServerPlugin.class);
        registerPlugin(NaigiApiPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
