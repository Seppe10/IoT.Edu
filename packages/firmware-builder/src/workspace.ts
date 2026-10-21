import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  applyCmakeProjectVersion,
  detectGpioConflicts,
  loadReferenceLayout,
  renderVersionSdkconfig,
  type BoardProfile,
} from "./index.js";

export interface Dht11WorkspaceOptions {
  repoRoot: string;
  outDir: string;
  softwareVersion?: number;
  softwareVersionString?: string;
  dht11Gpio?: number;
}

const APP_MAIN = `#include <esp_log.h>

#include <iotedu_core.h>
#include <iotedu_dht11.h>

#include <common_macros.h>

static const char *TAG = "app_main";

extern "C" void app_main(void)
{
    esp_matter::node_t *node = nullptr;
    esp_err_t err = iotedu_core_prepare(&node);
    ABORT_APP_ON_FAILURE(err == ESP_OK, ESP_LOGE(TAG, "Failed to prepare the Matter core, err:%d", err));

    err = iotedu_dht11_register(node);
    ABORT_APP_ON_FAILURE(err == ESP_OK, ESP_LOGE(TAG, "Failed to register DHT11, err:%d", err));

    err = iotedu_core_start();
    ABORT_APP_ON_FAILURE(err == ESP_OK, ESP_LOGE(TAG, "Failed to start Matter, err:%d", err));
}
`;

export async function generateDht11Workspace(options: Dht11WorkspaceOptions): Promise<{
  outDir: string;
  partitionLayoutId: string;
  dht11Gpio: number;
  softwareVersion: number;
  softwareVersionString: string;
}> {
  const softwareVersion = options.softwareVersion ?? 1;
  const softwareVersionString = options.softwareVersionString ?? "1.0";
  const dht11Gpio = options.dht11Gpio ?? 4;
  const repoRoot = path.resolve(options.repoRoot);
  const outDir = path.resolve(options.outDir);
  const referenceDir = path.resolve(repoRoot, "reference/matter-dht11");
  if (outDir === referenceDir || outDir.startsWith(referenceDir + path.sep)) {
    throw new Error("The generated workspace must not be written into reference/matter-dht11");
  }

  const profile = JSON.parse(
    await readFile(path.join(repoRoot, "board-profiles/esp32h2.json"), "utf8"),
  ) as BoardProfile;
  const issues = detectGpioConflicts(profile, [
    { componentId: "iotedu-dht11", pinName: "DHT11_DATA", gpio: dht11Gpio },
  ]);
  if (issues.some((issue) => issue.level === "error")) {
    throw new Error(issues.map((issue) => issue.message).join("; "));
  }

  const componentRoot = path.resolve(repoRoot, "firmware/components");
  const referenceCmake = await readFile(path.join(referenceDir, "CMakeLists.txt"), "utf8");
  const marker = `"\${ESP_MATTER_PATH}/components"`;
  if (!referenceCmake.includes(marker)) {
    throw new Error("Reference CMakeLists.txt no longer has the expected component list");
  }
  const generatedCmake = applyCmakeProjectVersion(
    referenceCmake.replace(marker, `${marker}\n    "${componentRoot}"`),
    softwareVersion,
    softwareVersionString,
  );

  await rm(outDir, { recursive: true, force: true });
  await mkdir(path.join(outDir, "main"), { recursive: true });

  await writeFile(path.join(outDir, "CMakeLists.txt"), generatedCmake);
  await writeFile(
    path.join(outDir, "partitions.csv"),
    await readFile(path.join(referenceDir, "partitions.csv")),
  );
  await writeFile(
    path.join(outDir, "sdkconfig.defaults.esp32h2"),
    await readFile(path.join(referenceDir, "sdkconfig.defaults.esp32h2")),
  );
  await writeFile(
    path.join(outDir, "dependencies.lock"),
    await readFile(path.join(referenceDir, "dependencies.lock")),
  );
  const defaults = await readFile(path.join(referenceDir, "sdkconfig.defaults"), "utf8");
  await writeFile(
    path.join(outDir, "sdkconfig.defaults"),
    `${defaults.trimEnd()}\n\n${renderVersionSdkconfig(softwareVersion, softwareVersionString)}CONFIG_IOTEDU_DHT11_PIN=${dht11Gpio}\n`,
  );
  await writeFile(
    path.join(outDir, "main/CMakeLists.txt"),
    `idf_component_register(SRCS "app_main.cpp"
                       INCLUDE_DIRS "."
                       PRIV_INCLUDE_DIRS "." "$ENV{ESP_MATTER_PATH}/examples/common/utils"
                       PRIV_REQUIRES iotedu_core iotedu_dht11)\n`,
  );
  await writeFile(path.join(outDir, "main/app_main.cpp"), APP_MAIN);
  await writeFile(
    path.join(outDir, "main/idf_component.yml"),
    await readFile(path.join(referenceDir, "main/idf_component.yml")),
  );

  const layout = await loadReferenceLayout(repoRoot, profile);
  return { outDir, partitionLayoutId: layout.layoutId, dht11Gpio, softwareVersion, softwareVersionString };
}
