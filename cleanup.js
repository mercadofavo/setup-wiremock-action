const core = require("@actions/core");
const fs = require("fs-extra");
const process = require("process");

const wait = (duration, ...args) =>
  new Promise(resolve => {
    setTimeout(resolve, duration, ...args);
  });

(async function () {
  try {
    const wiremockPid = fs.readFileSync("wiremock.pid", "utf8");
    process.kill(wiremockPid, "SIGTERM");
    await wait(1000); //kill is asynchronous and there is no killSync method. Required to wait for remaining stdout to be produced.
  } catch (err) {
    console.error(err)
  }
})().catch(error => {
  core.setFailed(error.message);
});
