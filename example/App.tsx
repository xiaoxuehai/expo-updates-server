import { StatusBar } from "expo-status-bar";
import * as Updates from "expo-updates";
import { useCallback, useEffect } from "react";
import { Alert, Button, StyleSheet, Text, View } from "react-native";

export default function App() {
  const {
    currentlyRunning,
    isChecking,
    isDownloading,
    isUpdateAvailable,
    isUpdatePending,
    checkError,
    downloadError,
  } = Updates.useUpdates();

  useEffect(() => {
    if (isUpdatePending) {
      Alert.alert("新版本已下载", "点击立即重启应用新版本", [
        { text: "稍后", style: "cancel" },
        { text: "立即重启", onPress: () => Updates.reloadAsync() },
      ]);
    }
  }, [isUpdatePending]);

  const onManualCheck = useCallback(async () => {
    try {
      const result = await Updates.checkForUpdateAsync();
      if (result.isAvailable) {
        await Updates.fetchUpdateAsync();
      } else {
        Alert.alert(
          "已是最新",
          `当前版本: ${currentlyRunning?.updateId ?? "embedded"}`,
        );
      }
    } catch (e: any) {
      Alert.alert("检查失败", e?.message ?? String(e));
    }
  }, [currentlyRunning]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Expo Updates Test App</Text>

      <View style={styles.updateBox}>
        <Text style={styles.updateTitle}>OTA 状态</Text>
        <Text>updateId: {currentlyRunning?.updateId ?? "(embedded)"}</Text>
        <Text>
          来源: {currentlyRunning?.isEmbeddedLaunch ? "原生包内嵌" : "OTA 下发"}
        </Text>
        <Text>runtimeVersion: {currentlyRunning?.runtimeVersion}</Text>

        {isChecking && <Text style={styles.info}>检查更新中...</Text>}
        {isDownloading && <Text style={styles.info}>下载更新中...</Text>}
        {isUpdateAvailable && !isUpdatePending && (
          <Text style={styles.info}>发现新版本，正在下载</Text>
        )}
        {isUpdatePending && (
          <Text style={styles.warn}>新版本已下载，待重启生效</Text>
        )}
        {checkError && (
          <Text style={styles.err}>检查错误: {checkError.message}</Text>
        )}
        {downloadError && (
          <Text style={styles.err}>下载错误: {downloadError.message}</Text>
        )}

        <View style={styles.buttonRow}>
          <Button title="手动检查更新" onPress={onManualCheck} />
        </View>
        {isUpdatePending && (
          <View style={styles.buttonRow}>
            <Button
              title="立即重启应用"
              onPress={() => Updates.reloadAsync()}
            />
          </View>
        )}
      </View>

      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 24,
  },
  updateBox: {
    padding: 16,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    width: "100%",
  },
  updateTitle: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 8,
  },
  info: {
    color: "#0066cc",
    marginTop: 4,
  },
  warn: {
    color: "#cc6600",
    marginTop: 4,
    fontWeight: "bold",
  },
  err: {
    color: "#cc0000",
    marginTop: 4,
  },
  buttonRow: {
    marginTop: 12,
  },
});
