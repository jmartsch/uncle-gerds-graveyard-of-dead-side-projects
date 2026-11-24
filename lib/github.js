import { call } from './connectors.js';

const JSON_HEADERS = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
const gh = (path, opts = {}) => call('github', path, { ...opts, headers: { ...JSON_HEADERS, ...(opts.headers || {}) } });

export async function listOwnRepos() {
  const repos = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await gh(`/user/repos?per_page=100&page=${page}&sort=pushed&direction=desc&affiliation=owner`);
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos;
}

export const getRepo = (fullName) => gh(`/repos/${fullName}`);

// Public repos of any GitHub user (guests). Never includes private repos.
export async function listUserRepos(username) {
  try {
    await gh(`/users/${encodeURIComponent(username)}`);
  } catch (err) {
    if (err.status === 404) throw new Error(`There is no GitHub user called "${username}".`);
    throw err;
  }
  const repos = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await gh(`/users/${encodeURIComponent(username)}/repos?per_page=100&page=${page}&sort=pushed&direction=desc&type=owner`);
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos.filter((r) => !r.private);
}

export async function getReadme(fullName) {
  try {
    return await gh(`/repos/${fullName}/readme`, { headers: { accept: 'application/vnd.github.raw+json' }, raw: true });
  } catch (err) {
    if (err.status === 404) return '';
    throw err;
  }
}

export async function getCommits(fullName, n = 5) {
  try {
    const list = await gh(`/repos/${fullName}/commits?per_page=${n}`);
    return list.map((c) => ({
      sha: c.sha.slice(0, 7),
      message: (c.commit?.message || '').split('\n')[0].slice(0, 140),
      date: c.commit?.author?.date || c.commit?.committer?.date || null,
      url: c.html_url,
    }));
  } catch (err) {
    if (err.status === 409 || err.status === 404) return []; // empty repository
    throw err;
  }
}

export async function getOpenIssues(fullName, n = 20) {
  try {
    const list = await gh(`/repos/${fullName}/issues?state=open&per_page=${n}`);
    return list
      .filter((i) => !i.pull_request)
      .map((i) => ({
        number: i.number,
        title: i.title.slice(0, 140),
        body: (i.body || '').slice(0, 600),
        url: i.html_url,
        comments: i.comments,
        created: i.created_at,
      }));
  } catch (err) {
    if (err.status === 410 || err.status === 404) return []; // issues disabled
    throw err;
  }
}

export const daysSince = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 86_400_000 : Infinity);

export const isDead = (repo, deadAfterDays) => !repo.fork && daysSince(repo.pushed_at) >= deadAfterDays;

// Prefer graves with a story: a description, a bit of code, some stars, open issues.
const interest = (repo) =>
  (repo.description ? 2 : 0) +
  Math.min(repo.stargazers_count || 0, 10) * 0.3 +
  (repo.size > 50 ? 1 : 0) +
  (repo.open_issues_count > 0 ? 1 : 0) +
  (repo.archived ? 0.5 : 0);

export async function pickDeadRepos({ explicit = [], max = 3, deadAfterDays = 365, includePrivate = false, owner = null } = {}) {
  // Explicitly chosen repos are shown even if private: that is the owner's decision.
  if (!owner && explicit.length) return Promise.all(explicit.map(getRepo));
  const repos = owner ? await listUserRepos(owner) : await listOwnRepos();
  return repos
    .filter((r) => isDead(r, deadAfterDays) && (includePrivate || !r.private))
    .sort((a, b) => interest(b) - interest(a))
    .slice(0, max);
}
