const core = require("@actions/core");
const tc = require("@actions/tool-cache");
const path = require("path");
const fs = require("fs-extra");
const cp = require("child_process");
const http = require("http");

const wiremockVersion = "2.26.3";
const wiremockStdOutPath = "out.log";
const wiremockStdErrPath = "err.log";
const wiremockStdOut = fs.createWriteStream(wiremockStdOutPath);
const wiremockStdErr = fs.createWriteStream(wiremockStdErrPath);

const inputs = getInputs();

/*
  Main logic starts
*/

installWiremockFromToolCache
  .then(state => {
    return {
      state,
      ...copyStubs(inputs.mappingsPath, inputs.filesPath, state.wiremockPath)
    };
  })
  .then(state => {
    copyWiremockPingMapping(wiremockPaths.wiremockMappingsPath);
    return state;
  })
  .then(state => {
    return {
      state,
      ...startWireMock(state.wiremockPath)
    };
  })
  .then(state => {
    return {
      state,
      ...isWireMockRunning()
    };
  })
  .then(state => {
    shutdownWiremock(state.wiremockProcess);
    return state;
  })
  .then(state => {
    setActionOutput();
    return state;
  })
  .catch(error => {
    core.setFailed(error.message);
    process.exit(1);
  });

/*
  Main logic ends
*/

const getInputs = () => {
  const mappingsPath = core.getInput("mappings", { required: true });
  const filesPath = core.getInput("mappings", { required: true });
  const httpPort = core.getInput("http-port")
    ? core.getInput("http-port")
    : "8080";

  return {
    mappingsPath: mappingsPath,
    filesPath: filesPath,
    httpPort: httpPort
  };
};

const installWiremockFromToolCache = async () => {
  let wiremockPath = tc.find("wiremock", wiremockVersion);
  if (wiremockPath) {
    return { wiremockPath: wiremockPath };
  } else {
    wiremockPath = await tc.downloadTool(
      `https://repo1.maven.org/maven2/com/github/tomakehurst/wiremock-standalone/${wiremockVersion}/wiremock-standalone-${wiremockVersion}.jar`
    );
    const cachedPath = await tc.cacheFile(
      wiremockPath,
      "wiremock",
      wiremockVersion
    );
    return { wiremockPath: cachedPath };
  }
};

//copy mappings and static files to ${wiremock-path}/mappings and ${wiremock-path}/__files
const copyStubs = (inputMappingsPath, inputFilesPath, wiremockPath) => {
  const wiremockParentPath = path.dirname(wiremockPath);
  const wiremockMappingsPath = path.join(wiremockParentPath, "mappings");
  const wiremockFilesPath = path.join(wiremockParentPath, "__files");
  fs.emptyDirSync(wiremockMappingsPath);
  fs.emptyDirSync(wiremockFilesPath);
  fs.copySync(inputMappingsPath, wiremockMappingsPath);
  fs.copySync(inputFilesPath, wiremockFilesPath);
  return {
    wiremockParentPath: wiremockParentPath,
    wiremockMappingsPath: wiremockMappingsPath,
    wiremockFilesPath: wiremockFilesPath
  };
};

const copyWiremockPingMapping = wiremockMappingsPath => {
  const pingMapping = path.join(__dirname, "__wiremock-ping-mapping.json");
  fs.copyFileSync(pingMapping, wiremockMappingsPath);
};

const startWireMock = wiremockPath => {
  const options = {
    detached: true
  };
  const wiremockProcess = cp.spawn("java", ["-jar", wiremockPath], options);
  wiremockProcess.stdout.on("data", data => {
    wiremockStdOut.write(data);
  });
  wiremockProcess.stderr.on("data", data => {
    wiremockStdErr.write(data);
  });
  return { wiremockProcess: wiremockProcess };
};

//check that Wiremock is running
const isWireMockRunning = () => {
  return http
    .get(`http://localhost:${inputs.httpPort}/__wiremock_ping`, response => {
      const { statusCode } = response;
      return { isWireMockRunning: statusCode === 200 };
    })
    .on("error", e => {
      throw e;
    });
};

//run tests from CLI (command to run tests to be given through action parameter)

//shutdown Wiremock
const shutdownWiremock = wiremockProcess => {
  wiremockProcess.kill();
  wiremockStdOut.end();
  wiremockStdErr.end();
};

//output Wiremock logging for stub mismatches
const setActionOutput = () => {
  const stdOutput = fs.readFileSync(wiremockStdOutPath, { encoding: "utf8" });
  core.setOutput("wiremock-stdout", stdOutput);
  const stdError = fs.readFileSync(wiremockStdErrPath, { encoding: "utf8" });
  core.setOutput("wiremock-stdout", stdError);
};
