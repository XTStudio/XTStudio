const fs = require('fs')
const xml2js = require('xml2js')
const child_process = require('child_process')
import { cmdExists } from "./utils";

export class AndroidRunner {

    packageName: string = ""
    mainActivityName: string = ""

    async run() {
        try {
            await this.checkAndroidSDK()
            await this.parseManifest()
            try {
                await this.checkDevice()
            } catch (error) {
                if (error.message === "No devices connected.") {
                    await this.startDevice()
                }
                else {
                    throw error
                }
            }
            await this.forwarkPorts()
            await this.gradleBuild()
            await this.runMainActivity()
        } catch (error) {
            console.error(error.message)
        }
    }

    private checkAndroidSDK() {
        return new Promise((res, rej) => {
            const echoProcess = child_process.exec("echo $ANDROID_HOME")
            echoProcess.stdout.on("data", (data: any) => {
                const dir = data.toString().trim()
                if (dir === undefined || dir.length === 0) {
                    rej(Error("ANDROID_HOME not found. Please setup ANDROID_HOME, See https://stackoverflow.com/questions/19986214/setting-android-home-enviromental-variable-on-mac-os-x ."))
                }
                else {
                    if (fs.existsSync(dir)) {
                        res()
                    }
                    else {
                        rej(Error("ANDROID_HOME not found. Please setup ANDROID_HOME, See https://stackoverflow.com/questions/19986214/setting-android-home-enviromental-variable-on-mac-os-x ."))
                    }
                }
            })
        })
    }

    private parseManifest(): Promise<any> {
        return new Promise((res, rej) => {
            const manifestContent = fs.readFileSync('platform/android/app/src/main/AndroidManifest.xml', { encoding: 'utf-8' })
            xml2js.parseString(manifestContent, (error: Error | undefined, result: any) => {
                if (error) {
                    rej(error)
                }
                else {
                    this.packageName = result.manifest.$.package
                    result.manifest.application[0].activity.forEach((it: any) => {
                        try {
                            if (it["intent-filter"][0].action[0].$["android:name"] === "android.intent.action.MAIN" &&
                                it["intent-filter"][0].category[0].$["android:name"] === "android.intent.category.LAUNCHER") {
                                this.mainActivityName = it.$["android:name"]
                            }
                        } catch (error) { }
                    })
                    if (this.packageName === "" || this.mainActivityName === "") {
                        rej(Error("Cannot found package name or main activity on Android app manifest.xml ."))
                    }
                    else {
                        res()
                    }
                }
            })
        })
    }

    private async checkDevice() {
        return new Promise((res, rej) => {
            const process = child_process.exec(`$ANDROID_HOME/platform-tools/adb devices`)
            process.stdout.on("data", (data: any) => {
                const lines = data.replace("List of devices attached\n", "").split("\n")
                const count = lines.filter((it: string) => it.indexOf("device") >= 0).length
                if (count === 1) {
                    res()
                }
                else if (count > 1) {
                    rej(Error("There are more than one device connected, please disconnect until just one."))
                }
                else {
                    rej(Error("No devices connected."))
                }
            })
        })
    }

    private async startDevice() {
        return new Promise((res, rej) => {
            const process = child_process.exec(`$ANDROID_HOME/emulator/emulator -list-avds`)
            let target: string | undefined = undefined
            process.stdout.on("data", (data: any) => {
                data.toString().split("\n").forEach((it: string) => {
                    if (it.trim().length > 0) {
                        target = it.trim()
                    }
                })
            })
            process.on("close", () => {
                if (target) {
                    child_process.exec(`$ANDROID_HOME/emulator/emulator -avd ${target} -dns-server 223.5.5.5`)
                    this.waitingDevice(res, rej)
                }
                else {
                    rej("Emulator not found, create at least one device via Android Studio please.")
                }
            })
        })
    }

    private waitingDevice(resolver: () => void, rejector: (error: Error) => void, retryTime: number = 0) {
        if (retryTime >= 30) { rejector(Error("Emulator start failed.")); return }
        console.log("Waiting device to connect.")
        const process = child_process.exec(`$ANDROID_HOME/platform-tools/adb devices`)
        process.stdout.on("data", (data: any) => {
            const lines = data.replace("List of devices attached\n", "").split("\n")
            const count = lines.filter((it: string) => it.indexOf("device") >= 0).length
            if (count === 1) {
                try {
                    child_process.execSync(`$ANDROID_HOME/platform-tools/adb shell am force-stop ${this.packageName}`, { cwd: './platform/android/', stdio: "inherit" })
                } catch (error) {
                    setTimeout(() => {
                        this.waitingDevice(resolver, rejector, retryTime + 1)
                    }, 2000)
                    return
                }
                resolver()
            }
            else if (count > 1) {
                try {
                    child_process.execSync(`$ANDROID_HOME/platform-tools/adb shell am force-stop ${this.packageName}`, { cwd: './platform/android/', stdio: "inherit" })
                } catch (error) {
                    setTimeout(() => {
                        this.waitingDevice(resolver, rejector, retryTime + 1)
                    }, 2000)
                    return
                }
                resolver()
            }
            else {
                setTimeout(() => {
                    this.waitingDevice(resolver, rejector, retryTime + 1)
                }, 2000)
            }
        })
    }

    private forwarkPorts() {
        child_process.execSync(`$ANDROID_HOME/platform-tools/adb reverse tcp:8090 tcp:8090`)
        child_process.execSync(`$ANDROID_HOME/platform-tools/adb reverse tcp:8091 tcp:8091`)
    }

    private gradleBuild(): Promise<any> {
        console.log("Runing gradle build ...")
        return new Promise((res, rej) => {
            try {
                child_process.execSync(`$ANDROID_HOME/platform-tools/adb shell am force-stop ${this.packageName}`, { cwd: './platform/android/', stdio: "inherit" })
                child_process.execSync(`sh ./gradlew installDebug`, { cwd: './platform/android/', stdio: "inherit" })
                res()
            } catch (error) {
                rej(error)
            }
        })
    }

    private async runMainActivity() {
        child_process.execSync(`$ANDROID_HOME/platform-tools/adb shell am start -n ${this.packageName}/${this.mainActivityName}`, { cwd: './platform/android/', stdio: "inherit" })
    }

}