const { Octokit } = require("octokit");
const octokit = new Octokit({ auth: process.env.GITHUB_PAT });

async function run() {
  try {
    const { data: pulls } = await octokit.rest.pulls.list({
      owner: process.env.GITHUB_OWNER || "yananob",
      repo: "my-cfapps-portal",
      state: "open"
    });
    console.log(JSON.stringify(pulls.map(p => ({ number: p.number, title: p.title, head: p.head.ref })), null, 2));
  } catch (e) {
    console.error(e.message);
  }
}
run();
