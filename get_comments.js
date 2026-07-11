const { Octokit } = require("octokit");
const octokit = new Octokit({ auth: process.env.GITHUB_PAT });

async function run() {
  try {
    const { data: comments } = await octokit.rest.issues.listComments({
      owner: "yananob",
      repo: "my-cfapps-portal",
      issue_number: 51
    });
    console.log(JSON.stringify(comments.map(c => ({ user: c.user.login, body: c.body })), null, 2));
  } catch (e) {
    console.error(e.message);
  }
}
run();
