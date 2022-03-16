const core = require("@actions/core");
const tc = require("@actions/tool-cache");
const path = require("path");
const fs = require("fs-extra");
const cp = require("child_process");
const process = require("process");
const got = require("got");
const minimist = require("minimist-string");

const wiremockVersion = "2.26.3";
const wiremockArtifactName = `wiremock-standalone-${wiremockVersion}.jar`;
const wiremockPingMappingFileName = "__wiremock-ping-mapping.json";
const cwd = process.cwd();

const getInputs = () => {
  const mappingsPath = core.getInput("mappings", { required: true });
  const filesPath = core.getInput("files", { required: true });
  const httpPort = core.getInput("http-port")
    ? core.getInput("http-port")
    : "8080";
  const isVerboseLogging = core.getInput("verbose") === "true" ? true : false;

  return {
    mappingsPath: mappingsPath,
    filesPath: filesPath,
    httpPort: httpPort,
    isVerboseLogging: isVerboseLogging
  };
};

const installWiremockFromToolCache = async () => {
  let wiremockPath = tc.find("wiremock", wiremockVersion);
  if (wiremockPath) {
    return { wiremockPath: path.join(wiremockPath, wiremockArtifactName) };
  } else {
    wiremockPath = await tc.downloadTool(
      `https://repo1.maven.org/maven2/com/github/tomakehurst/wiremock-standalone/${wiremockVersion}/${wiremockArtifactName}`
    );
    const cachedPath = await tc.cacheFile(
      wiremockPath,
      `wiremock-standalone-${wiremockVersion}.jar`,
      "wiremock",
      wiremockVersion
    );
    return path.join(cachedPath, wiremockArtifactName);
  }
};

const copyStubs = (inputMappingsPath, inputFilesPath) => {
  // we are going to start Wiremock in the current working directory, not in Wiremock's directory
  const wiremockMappingsPath = path.join(cwd, "mappings");
  const wiremockFilesPath = path.join(cwd, "__files");
  const pingMapping = path.join(__dirname, wiremockPingMappingFileName);
  fs.emptyDirSync(wiremockMappingsPath);
  fs.emptyDirSync(wiremockFilesPath);
  fs.copySync(inputMappingsPath, wiremockMappingsPath);
  fs.copySync(inputFilesPath, wiremockFilesPath);
  fs.copyFileSync(
    pingMapping,
    path.join(wiremockMappingsPath, wiremockPingMappingFileName)
  );
  return {
    currentWorkingDirectory: cwd,
    wiremockMappingsPath: wiremockMappingsPath,
    wiremockFilesPath: wiremockFilesPath
  };
};

const startWireMock = (wiremockPath, isVerboseLogging) => {
  const options = {
    cwd: cwd,
    detached: true,
    stdio: 'ignore',
};
  let args = ["-jar", wiremockPath];
  if (isVerboseLogging) {
    args.push("--verbose");
  }
  const wiremockProcess = cp.spawn("java", args, options);
  wiremockProcess.unref();
  return wiremockProcess;
};

const writePIDfile = (wiremockProcess) => {
  fs.writeFile('wiremock.pid', `${wiremockProcess.pid}`, err => {
    if (err) {
      console.error(err);
      throw "Could not write PID file";
    }
  })
}

const isWireMockRunning = async httpPort => {
  try {
    const retry = {
      retry: {
        limit: 5
      }
    };
    const response = await got(
      `http://localhost:${httpPort}/__wiremock_ping`,
      retry
    );
    return response.statusCode === 200;
  } catch (e) {
    throw e; // rethrow on got errors like ECONNREFUSED so that main error handling can catch this error.
  }
};

//output Wiremock logging for stub mismatches
const setActionOutput = () => {
  const stdOutput = fs.readFileSync(wiremockStdOutPath, { encoding: "utf8" });
  core.setOutput("wiremock-stdout", stdOutput);
};

const cleanupFiles = (wiremockMappingsPath, wiremockFilesPath) => {
  fs.removeSync(wiremockMappingsPath);
  fs.removeSync(wiremockFilesPath);
};

/*
Main logic starts
*/

(async function () {
  try {
    const {
      mappingsPath,
      filesPath,
      httpPort,
      testCommandString,
      isVerboseLogging
    } = getInputs();

    const wiremockPath = await installWiremockFromToolCache();

    var { wiremockMappingsPath, wiremockFilesPath } = copyStubs(
      mappingsPath,
      filesPath
    );
    var wiremockProcess = startWireMock(wiremockPath.wiremockPath, isVerboseLogging);
    writePIDfile(wiremockProcess);
    var isRunning = await isWireMockRunning(httpPort);

    if (isRunning) {
      console.log("WireMock is up and running");
    } else {
      throw "Wiremock was not running.";
    }
  } catch (error) {
    console.error(error);
    core.setFailed(error.message);
  } finally {
    if (!(isRunning)) {
      core.setFailed("Errors during test setup");
    }
  }
})().catch(error => {
  core.setFailed(error.message);
});

/*
  Main logic ends
*/
