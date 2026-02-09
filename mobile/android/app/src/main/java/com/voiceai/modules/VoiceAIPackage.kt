/**
 * VoiceAIPackage — Registers all native modules with React Native.
 *
 * Add this package to the getPackages() list in MainApplication.
 */

package com.voiceai.modules

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class VoiceAIPackage : ReactPackage {

    override fun createNativeModules(
        reactContext: ReactApplicationContext
    ): List<NativeModule> {
        return listOf(
            AudioCaptureModule(reactContext),
            SherpaOnnxModule(reactContext),
            VADModule(reactContext),
        )
    }

    override fun createViewManagers(
        reactContext: ReactApplicationContext
    ): List<ViewManager<*, *>> {
        return emptyList()
    }
}
