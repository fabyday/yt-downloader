const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');

/** Calls the REST API without shell interpolation. Boolean fields use gh's typed input. */
function api(run, repository, method, resource, fields = {}) {
  const args = ['api', '--method', method, `repos/${repository}/${resource}`];
  for (const [key, value] of Object.entries(fields)) args.push(typeof value === 'boolean' ? '-F' : '-f', `${key}=${value}`);
  const result = run(args);
  return result.trim() ? JSON.parse(result) : undefined;
}

/** Rejects published, renamed, or concurrently edited releases before destructive changes. */
function requireDraft(run, repository, snapshot, tag = snapshot.tag_name) {
  const current = api(run, repository, 'GET', `releases/${snapshot.id}`);
  if (!current.draft || current.tag_name !== tag || current.updated_at !== snapshot.updated_at)
    throw new Error('Draft changed during the build; refusing to replace it.');
  return current;
}

/** Confirms the whole uploaded asset set, including manifests/icon, before replacing the previous draft. */
function verifyAssets(run, repository, release, files, hashes) {
  const assets = JSON.parse(run(['api', '--paginate', '--slurp', `repos/${repository}/releases/${release.id}/assets?per_page=100`])).flat();
  if (assets.length !== files.length) throw new Error('Incomplete draft asset set.');
  for (const file of files) {
    const asset = assets.find(item => item.name === path.basename(file));
    if (!asset || asset.state !== 'uploaded' || asset.size !== fs.statSync(file).size ||
      (asset.digest && asset.digest !== `sha256:${hashes.get(path.basename(file))}`))
      throw new Error(`Draft asset verification failed: ${path.basename(file)}`);
  }
}

/**
 * Uploads a replacement before touching the previous draft. Keeps notes and never publishes.
 * @param options Native build outputs, exact SHA, prior remote snapshot and version recheck callback.
 * @returns Verified canonical draft URL. Cleanup failures fail CI with recoverable drafts retained.
 * @remarks GitHub release/ref writes are not transactional. Rollback restores the previous tag/draft
 * when promotion fails; uncertain responses are reconciled by release ID before any deletion.
 */
async function replaceDraft(options) {
  const { repository, version, sha, files, manifest, remote, checkRemote, run } = options;
  const canonical = `v${version}`, suffix = randomUUID();
  const stagingTag = `kawai-build-${version}-${suffix}`;
  const backupTag = `kawai-backup-${version}-${suffix}`;
  const previous = remote.replacement;
  const hashes = new Map(manifest.artifacts.map(item => [decodeURIComponent(new URL(item.url).pathname.split('/').at(-1)), item.sha256]));
  for (const file of files) if (!hashes.has(path.basename(file)))
    hashes.set(path.basename(file), createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
  const notes = previous?.body ?? api(run, repository, 'POST', 'releases/generate-notes', { tag_name: canonical, target_commitish: sha }).body;
  let staged, backup, priorRef, refAttempted = false, backupAttempted = false, promoted = false;
  try {
    staged = api(run, repository, 'POST', 'releases', {
      tag_name: stagingTag, target_commitish: sha, name: `kawai-downloader ${canonical}`,
      body: notes, draft: true, prerelease: options.prerelease,
    });
    run(['release', 'upload', stagingTag, '--repo', repository, ...files]);
    verifyAssets(run, repository, staged, files, hashes);
    staged = api(run, repository, 'GET', `releases/${staged.id}`);
    if (!staged.draft || staged.tag_name !== stagingTag) throw new Error('Staging draft changed during upload.');
    const fresh = checkRemote(repository, version, run);
    if (fresh.replacement?.id !== previous?.id) throw new Error('Draft changed during upload.');
    if (previous) requireDraft(run, repository, previous);
    requireDraft(run, repository, staged);
    if (fresh.tags.some(tag => tag.name === canonical)) {
      if (!previous) throw new Error('Refusing to move a tag without its unpublished draft.');
      priorRef = api(run, repository, 'GET', `git/ref/tags/${canonical}`);
      if (priorRef.object.type !== 'commit') throw new Error('Refusing to rewrite an annotated tag.');
    }
    if (previous) {
      backupAttempted = true;
      backup = api(run, repository, 'PATCH', `releases/${previous.id}`, { tag_name: backupTag });
    }
    if (backup) requireDraft(run, repository, backup);
    refAttempted = true;
    if (priorRef) {
      // Only an unpublished same-version draft can authorize moving this lightweight tag.
      api(run, repository, 'PATCH', `git/refs/tags/${canonical}`, { sha, force: true });
    } else {
      api(run, repository, 'POST', 'git/refs', { ref: `refs/tags/${canonical}`, sha });
    }
    try {
      staged = api(run, repository, 'PATCH', `releases/${staged.id}`, { tag_name: canonical, target_commitish: sha });
    } catch (error) {
      const actual = api(run, repository, 'GET', `releases/${staged.id}`);
      if (actual.tag_name !== canonical || !actual.draft) throw error;
      staged = actual;
    }
    if (!staged.draft || staged.tag_name !== canonical) throw new Error('Draft promotion was not confirmed.');
    promoted = true;
    if (backup) {
      requireDraft(run, repository, backup);
      api(run, repository, 'DELETE', `releases/${backup.id}`);
    }
    return staged.html_url;
  } catch (error) {
    if (!promoted) {
      try {
        // A lost response may have applied a mutation: inspect actual state first.
        if (staged) {
          const current = api(run, repository, 'GET', `releases/${staged.id}`);
          if (!current.draft || current.tag_name !== stagingTag) throw new Error('Replacement state is uncertain; drafts retained for recovery.');
        }
        if (refAttempted) {
          let ref;
          try { ref = api(run, repository, 'GET', `git/ref/tags/${canonical}`); }
          catch (failure) { if (!/HTTP 404/.test(String(failure.stderr || failure.message))) throw failure; }
          if (ref?.object.sha === sha) {
            if (priorRef) api(run, repository, 'PATCH', `git/refs/tags/${canonical}`, { sha: priorRef.object.sha, force: true });
            else api(run, repository, 'DELETE', `git/refs/tags/${canonical}`);
          } else if (ref?.object.sha !== priorRef?.object.sha) {
            throw new Error('Tag changed concurrently; drafts retained for recovery.');
          }
        }
        if (!backup && backupAttempted) {
          const current = api(run, repository, 'GET', `releases/${previous.id}`);
          if (!current.draft) throw new Error('Previous release was published; retained for recovery.');
          if (current.tag_name === backupTag) backup = current;
          else if (current.tag_name !== canonical) throw new Error('Previous draft changed; retained for recovery.');
        }
        if (backup) {
          requireDraft(run, repository, backup);
          api(run, repository, 'PATCH', `releases/${backup.id}`, { tag_name: canonical });
        }
        if (staged) api(run, repository, 'DELETE', `releases/${staged.id}`);
      } catch (recovery) {
        throw new Error(`${error.message} Recovery requires review: ${recovery.message}`);
      }
    }
    throw error;
  }
}
module.exports = { replaceDraft };
