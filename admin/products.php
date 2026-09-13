<?php
declare(strict_types=1);
require_once __DIR__ . '/inc.php';
require_once __DIR__ . '/../lib/Overlay.php';
$pdo = db();

function slugify(string $s): string {
    $s = strtolower(trim($s));
    $s = preg_replace('/[^a-z0-9]+/', '-', $s);
    return trim($s, '-') ?: 'item-' . random_int(1000, 9999);
}

/* --------------------------------------------------------------------------
 * AJAX endpoints (admin-only via require_admin() in inc.php header helpers).
 * These must run before any HTML is emitted. Both validate and preview accept
 * the HTML as a JSON string, so uploaded files (read client-side) and pasted
 * HTML go through the exact same server-side pipeline.
 * ------------------------------------------------------------------------ */
if ($_SERVER['REQUEST_METHOD'] === 'POST' && in_array(($_POST['action'] ?? ''), ['validate','preview'], true)) {
    require_admin();
    csrf_check();
    $action = $_POST['action'];
    $html = (string)($_POST['overlay_html'] ?? '');
    $proc = process_custom_overlay_html($html);

    if ($action === 'validate') {
        header('Content-Type: application/json');
        if (!$proc['ok']) { echo json_encode(['ok' => false, 'error' => $proc['error']]); exit; }
        $groups = 0; $fields = 0;
        foreach ($proc['schema'] as $g => $fs) { $groups++; if (is_array($fs)) $fields += count($fs); }
        echo json_encode(['ok' => true, 'hasSchema' => $proc['hasSchema'], 'groups' => $groups,
                          'fields' => $fields, 'bytes' => strlen($proc['html'])]);
        exit;
    }
    // preview: render the overlay with its schema DEFAULTS so an admin can see it before saving.
    header('X-Frame-Options: SAMEORIGIN');
    header('Content-Type: text/html; charset=utf-8');
    if (!$proc['ok']) {
        echo '<!doctype html><meta charset=utf-8><body style="margin:0;background:#171322;color:#f1edf8;font:14px system-ui;padding:18px">'
           . '<b>Cannot preview.</b><br>' . e($proc['error']) . '</body>';
        exit;
    }
    $fake = ['product_schema' => $proc['schemaJson'], 'settings' => null, 'product_html' => $proc['html']];
    Overlay::renderCustomPage($fake);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_check();
    $action = $_POST['action'] ?? '';

    if ($action === 'restore_overlay') {
        $id = (int)($_POST['id'] ?? 0);
        // Atomic swap of current <-> previous HTML/schema.
        $pdo->prepare("UPDATE products
            SET overlay_html=overlay_prev_html, overlay_schema=overlay_prev_schema,
                overlay_prev_html=overlay_html, overlay_prev_schema=overlay_schema,
                overlay_version=overlay_version+1, overlay_updated_at=NOW()
            WHERE id=? AND kind='custom' AND overlay_prev_html IS NOT NULL")->execute([$id]);
        audit('custom_overlay_restore', 'product #' . $id);
        flash('Previous overlay version restored.');
        redirect('admin/products.php?edit=' . $id);
    }

    if ($action === 'save') {
        $id = (int)($_POST['id'] ?? 0);
        $title = trim((string)($_POST['title'] ?? ''));
        if ($title === '') { flash('Title is required.'); redirect('admin/products.php'); }
        $kind = ($_POST['kind'] ?? 'chat') === 'custom' ? 'custom' : 'chat';

        // Resolve custom HTML from an uploaded file OR the pasted textarea, through
        // the single validated pipeline. On any failure we redirect BEFORE touching
        // the database, so an existing saved overlay is never modified by a bad edit.
        $proc = null; $haveNew = false;
        if ($kind === 'custom') {
            $html = '';
            if (!empty($_FILES['overlay_file']['tmp_name']) && is_uploaded_file($_FILES['overlay_file']['tmp_name'])) {
                if ((int)($_FILES['overlay_file']['error'] ?? 0) !== UPLOAD_ERR_OK) {
                    flash('Custom overlay: the file upload failed. Try again.'); redirect('admin/products.php' . ($id ? '?edit=' . $id : ''));
                }
                $name = (string)($_FILES['overlay_file']['name'] ?? '');
                if (!preg_match('/\.html?$/i', $name)) {
                    flash('Custom overlay: only .html/.htm files are accepted.'); redirect('admin/products.php' . ($id ? '?edit=' . $id : ''));
                }
                $html = (string)file_get_contents($_FILES['overlay_file']['tmp_name']);
            } elseif (trim((string)($_POST['overlay_html'] ?? '')) !== '') {
                $html = (string)($_POST['overlay_html'] ?? '');
            }
            if ($html !== '') {
                $proc = process_custom_overlay_html($html);
                if (!$proc['ok']) {
                    audit('custom_overlay_error', $proc['error']);
                    flash('Custom overlay not saved — ' . $proc['error']);
                    redirect('admin/products.php' . ($id ? '?edit=' . $id : ''));
                }
                $haveNew = true;
            } elseif ($id === 0) {
                flash('Please upload or paste the overlay HTML for a custom product.'); redirect('admin/products.php');
            }
        }

        $data = [
            $title,
            in_array($_POST['category'] ?? '', ['overlay','script','tool'], true) ? $_POST['category'] : 'overlay',
            $kind,
            trim((string)($_POST['short_desc'] ?? '')),
            trim((string)($_POST['description'] ?? '')),
            trim((string)($_POST['features'] ?? '')),
            trim((string)($_POST['price_label'] ?? '')) ?: 'Contact for access',
            trim((string)($_POST['image'] ?? '')) ?: null,
            isset($_POST['is_activatable']) ? 1 : 0,
            isset($_POST['active']) ? 1 : 0,
            (int)($_POST['sort_order'] ?? 0),
        ];
        if ($id > 0) {
            $cols = 'title=?,category=?,kind=?,short_desc=?,description=?,features=?,price_label=?,image=?,is_activatable=?,active=?,sort_order=?';
            $params = $data;
            if ($kind === 'chat') {
                // Switching to the built-in chat overlay clears the custom payload.
                $cols .= ',overlay_html=NULL,overlay_schema=NULL';
            } elseif ($haveNew) {
                // Atomic replace + keep the previous version for rollback. The prev
                // columns are listed first so they read the OLD values.
                $cols .= ',overlay_prev_html=overlay_html,overlay_prev_schema=overlay_schema'
                       . ',overlay_html=?,overlay_schema=?,overlay_version=overlay_version+1,overlay_updated_at=NOW()';
                $params[] = $proc['html']; $params[] = $proc['schemaJson'];
            }
            // else: custom edit without new HTML -> KEEP existing overlay_html/schema untouched.
            $pdo->prepare("UPDATE products SET $cols WHERE id=?")->execute([...$params, $id]);
            if ($haveNew) audit('custom_overlay_update', 'product #' . $id . ' (' . strlen($proc['html']) . ' bytes)');
            flash('Product updated.');
        } else {
            $slug = slugify($title);
            $c = $pdo->prepare('SELECT id FROM products WHERE slug=?'); $c->execute([$slug]);
            if ($c->fetch()) $slug .= '-' . random_int(100, 999);
            $sql = 'INSERT INTO products (title,category,kind,short_desc,description,features,price_label,image,is_activatable,active,sort_order,overlay_html,overlay_schema,overlay_version,overlay_updated_at,slug)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)';
            $pdo->prepare($sql)->execute([...$data,
                $kind === 'custom' ? $proc['html'] : null,
                $kind === 'custom' ? $proc['schemaJson'] : null,
                1, $kind === 'custom' ? date('Y-m-d H:i:s') : null, $slug]);
            if ($kind === 'custom') audit('custom_overlay_create', $title);
            flash('Product created.');
        }
        redirect('admin/products.php');
    }
    if ($action === 'delete') {
        $pdo->prepare('DELETE FROM products WHERE id=?')->execute([(int)($_POST['id'] ?? 0)]);
        flash('Product deleted.');
        redirect('admin/products.php');
    }
}

$edit = null;
if (isset($_GET['edit'])) {
    $s = $pdo->prepare('SELECT * FROM products WHERE id=?'); $s->execute([(int)$_GET['edit']]); $edit = $s->fetch() ?: null;
}
$rows = $pdo->query('SELECT * FROM products ORDER BY sort_order, id')->fetchAll();
admin_head('Products', 'products');
$v = fn($k, $d = '') => e($edit[$k] ?? $d);

// Schema status for the product being edited (for the admin status panel).
$editSchemaErr = null; $editSchemaGroups = 0; $editSchemaFields = 0; $editHasSchema = false;
if ($edit && ($edit['kind'] ?? 'chat') === 'custom' && !empty($edit['overlay_html'])) {
    $editHasSchema = has_overlay_schema_block((string)$edit['overlay_html']);
    $sc = json_decode((string)($edit['overlay_schema'] ?? 'null'), true);
    if (is_array($sc)) {
        $editSchemaErr = validate_overlay_schema($sc);
        foreach ($sc as $g => $fs) { $editSchemaGroups++; if (is_array($fs)) $editSchemaFields += count($fs); }
    } elseif ($editHasSchema) {
        $editSchemaErr = 'Stored schema is not valid JSON.';
    }
}
?>
<div class="panel">
  <h2><?= $edit ? 'Edit product' : 'Add a product' ?></h2>
  <form method="post" enctype="multipart/form-data" id="prodForm">
    <?= csrf_field() ?><input type="hidden" name="action" value="save"><input type="hidden" name="id" value="<?= $edit['id'] ?? 0 ?>">
    <div class="row">
      <div class="field"><label>Title</label><input type="text" name="title" required value="<?= $v('title') ?>"></div>
      <div class="field" style="max-width:180px"><label>Category</label>
        <select name="category">
          <?php foreach (['overlay','script','tool'] as $c): ?>
            <option value="<?= $c ?>" <?= ($edit['category'] ?? 'overlay')===$c?'selected':'' ?>><?= ucfirst($c) ?></option>
          <?php endforeach; ?>
        </select></div>
      <div class="field" style="max-width:170px"><label>Kind</label>
        <select name="kind" id="kindSel">
          <option value="chat" <?= ($edit['kind'] ?? 'chat')==='chat'?'selected':'' ?>>Chat overlay</option>
          <option value="custom" <?= ($edit['kind'] ?? 'chat')==='custom'?'selected':'' ?>>Custom (uploaded HTML)</option>
        </select></div>
      <div class="field" style="max-width:200px"><label>Price label</label><input type="text" name="price_label" value="<?= $v('price_label','Included with your key') ?>"></div>
    </div>
    <div class="field"><label>Short description</label><input type="text" name="short_desc" value="<?= $v('short_desc') ?>"></div>
    <div class="field"><label>Full description</label><textarea name="description"><?= $v('description') ?></textarea></div>
    <div class="field"><label>Features <span class="hint">(one per line)</span></label><textarea name="features"><?= $v('features') ?></textarea></div>

    <div class="field" id="customBlock" style="<?= ($edit['kind'] ?? 'chat')==='custom'?'':'display:none' ?>">
      <label>Custom overlay HTML <span class="hint">(single self-contained .html file)</span></label>
      <input type="file" name="overlay_file" id="ovFile" accept=".html,.htm,text/html">
      <div class="hint">Upload one HTML file, or paste below. It may embed a <span class="mono">&lt;script type="application/json" id="overlay-schema"&gt;…&lt;/script&gt;</span> block listing customisable fields (a schema-less file is accepted as a static overlay). Authors read <span class="mono">window.OVERLAY_SETTINGS</span>, CSS vars <span class="mono">--ov-group-key</span>, and/or define <span class="mono">window.applySettings(s)</span>.</div>

      <details style="margin-top:8px" <?= ($edit && ($edit['kind']??'')==='custom')?'open':'' ?>><summary class="hint" style="cursor:pointer">…or paste the HTML instead</summary>
        <textarea name="overlay_html" id="ovPaste" rows="10" placeholder="&lt;!doctype html&gt; …" style="font-family:ui-monospace,Menlo,Consolas,monospace;width:100%"></textarea>
      </details>

      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
        <button type="button" class="btn btn-ghost btn-sm" id="btnValidate">Validate overlay</button>
        <button type="button" class="btn btn-ghost btn-sm" id="btnPreview">Preview</button>
        <span id="valStatus" class="hint" style="align-self:center"></span>
      </div>
      <div id="previewWrap" style="display:none;margin-top:10px">
        <iframe id="ovPreview" title="overlay preview" style="width:100%;height:320px;border:1px solid var(--line);border-radius:10px;background:#171322"></iframe>
      </div>

      <?php if ($edit && ($edit['kind'] ?? '')==='custom' && !empty($edit['overlay_html'])): ?>
        <div class="note" style="margin-top:10px">
          <b>Stored overlay</b> · <?= number_format(strlen((string)$edit['overlay_html'])) ?> bytes
          · v<?= (int)($edit['overlay_version'] ?? 1) ?>
          <?php if (!empty($edit['overlay_updated_at'])): ?> · updated <?= e((string)$edit['overlay_updated_at']) ?><?php endif; ?>
          · Schema:
          <?php if ($editSchemaErr): ?><span class="badge expired">Invalid — <?= e($editSchemaErr) ?></span>
          <?php elseif (!$editHasSchema): ?><span class="badge">None (static overlay)</span>
          <?php else: ?><span class="badge active">Valid</span> (<?= $editSchemaGroups ?> groups, <?= $editSchemaFields ?> fields)<?php endif; ?>
          <br><span class="hint">Leave the file/paste blank to keep this stored HTML during other edits.</span>
          <?php if (!empty($edit['overlay_prev_html'])): ?>
            <form method="post" style="display:inline;margin-left:8px"><?= csrf_field() ?>
              <input type="hidden" name="action" value="restore_overlay"><input type="hidden" name="id" value="<?= (int)$edit['id'] ?>">
              <button class="btn btn-ghost btn-sm" onclick="return confirm('Restore the previous stored HTML/schema?')">Restore previous version</button>
            </form>
          <?php endif; ?>
        </div>
      <?php endif; ?>
    </div>

    <div class="row">
      <div class="field"><label>Image URL <span class="hint">(optional)</span></label><input type="url" name="image" value="<?= $v('image') ?>"></div>
      <div class="field" style="max-width:130px"><label>Sort order</label><input type="number" name="sort_order" value="<?= $v('sort_order','0') ?>"></div>
    </div>
    <div class="row" style="align-items:center">
      <label style="display:flex;gap:8px;align-items:center;flex:0"><input type="checkbox" name="is_activatable" <?= ($edit['is_activatable'] ?? 1)?'checked':'' ?> style="width:18px;height:18px"> Activatable overlay (keys can unlock it)</label>
      <label style="display:flex;gap:8px;align-items:center;flex:0"><input type="checkbox" name="active" <?= ($edit['active'] ?? 1)?'checked':'' ?> style="width:18px;height:18px"> Visible in store</label>
    </div>
    <div style="display:flex;gap:10px;margin-top:6px">
      <button class="btn btn-primary"><?= $edit ? 'Save changes' : 'Create product' ?></button>
      <?php if ($edit): ?><a class="btn btn-ghost" href="<?= e(url('admin/products.php')) ?>">Cancel</a><?php endif; ?>
    </div>
  </form>
</div>

<div class="panel">
  <h2>All products (<?= count($rows) ?>)</h2>
  <div class="table-wrap"><table>
    <thead><tr><th>Title</th><th>Category</th><th>Kind</th><th>Activatable</th><th>Visible</th><th></th></tr></thead><tbody>
    <?php foreach ($rows as $r): ?>
      <tr>
        <td><strong><?= e($r['title']) ?></strong><br><span class="mut mono" style="font-size:12px"><?= e($r['slug']) ?></span></td>
        <td><span class="tag <?= e($r['category']) ?>"><?= e($r['category']) ?></span></td>
        <td><?= ($r['kind'] ?? 'chat')==='custom' ? '🎨 custom' : '💬 chat' ?></td>
        <td><?= $r['is_activatable'] ? '✅' : '—' ?></td>
        <td><?= $r['active'] ? '✅' : '—' ?></td>
        <td style="text-align:right;white-space:nowrap">
          <a class="btn btn-ghost btn-sm" href="<?= e(url('admin/products.php?edit=' . $r['id'])) ?>">Edit</a>
          <form method="post" style="display:inline"><?= csrf_field() ?><input type="hidden" name="id" value="<?= $r['id'] ?>">
            <button class="btn btn-danger btn-sm" name="action" value="delete" onclick="return confirm('Delete this product and its keys/overlays?')">Delete</button>
          </form>
        </td>
      </tr>
    <?php endforeach; ?>
    </tbody></table></div>
</div>
<script>
(function(){
  var k=document.getElementById('kindSel'), b=document.getElementById('customBlock');
  if(k&&b){ function t(){ b.style.display = k.value==='custom' ? '' : 'none'; } k.addEventListener('change',t); t(); }

  var csrf = <?= json_encode(csrf_token()) ?>;
  var fileEl=document.getElementById('ovFile'), pasteEl=document.getElementById('ovPaste');
  var stat=document.getElementById('valStatus');
  function readHtml(){ return new Promise(function(res){
    if(fileEl && fileEl.files && fileEl.files[0]){ var fr=new FileReader(); fr.onload=function(){res(String(fr.result||''));}; fr.onerror=function(){res('');}; fr.readAsText(fileEl.files[0]); }
    else res(pasteEl ? pasteEl.value : '');
  }); }
  function post(action, html){ var fd=new FormData(); fd.append('_csrf',csrf); fd.append('action',action); fd.append('overlay_html',html); return fetch(location.href,{method:'POST',body:fd}); }

  var bv=document.getElementById('btnValidate');
  if(bv) bv.onclick=async function(){ var html=await readHtml(); if(!html){stat.textContent='Nothing to validate — upload or paste HTML first.';return;}
    stat.textContent='Validating…';
    try{ var j=await (await post('validate',html)).json();
      if(j.ok) stat.innerHTML='<span style="color:#53d986">✓ Valid</span> · '+(j.hasSchema?(j.groups+' groups, '+j.fields+' fields'):'no schema (static overlay)')+' · '+j.bytes+' bytes';
      else stat.innerHTML='<span style="color:#ff8080">✗ '+String(j.error).replace(/</g,'&lt;')+'</span>';
    }catch(e){ stat.textContent='Validation request failed.'; }
  };
  var bp=document.getElementById('btnPreview');
  if(bp) bp.onclick=async function(){ var html=await readHtml(); if(!html){stat.textContent='Nothing to preview — upload or paste HTML first.';return;}
    var wrap=document.getElementById('previewWrap'), fr=document.getElementById('ovPreview');
    try{ var r=await post('preview',html); var text=await r.text(); wrap.style.display='';
      var doc=fr.contentDocument||fr.contentWindow.document; doc.open(); doc.write(text); doc.close();
    }catch(e){ stat.textContent='Preview request failed.'; }
  };
})();
</script>
<?php admin_foot();
