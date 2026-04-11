import subprocess, sys, os, re

content = open('index.html', encoding='utf-8').read()
lines = content.split('\n')
print(f'Total lines: {len(lines)}')

# Find all <script> and </script> tag positions
script_opens = [i for i, l in enumerate(lines) if re.match(r'\s*<script\b(?!\s+src)', l)]
script_closes = [i for i, l in enumerate(lines) if '</script>' in l]
script_types = {i: (re.search(r'type=["\']([^"\']+)["\']', lines[i]) or type('', (), {'group': lambda s,n: ''})()).group(1)
                for i in script_opens}

print(f'Script blocks found: {len(script_opens)} opens, {len(script_closes)} closes')

blocks = []
for open_idx in script_opens:
    # Find matching close after this open
    close_idx = next((c for c in script_closes if c > open_idx), None)
    if close_idx:
        blocks.append((f'Script L{open_idx+1}', open_idx, close_idx))

all_ok = True
for name, start_idx, end_idx in blocks:
    # Skip CDN module blocks (Firebase SDK etc.) — node can't resolve https:// imports
    if 'module' in (script_types.get(start_idx, '') or '') and 'https://' in '\n'.join(lines[start_idx+1:end_idx]):
        print(f'  {name}: Ignoré (module CDN https://)')
        continue
    # Extract content between tags (skip the <script> tag itself)
    part = '\n'.join(lines[start_idx+1:end_idx])
    if not part.strip():
        continue
    open('tmp_check.js', 'w', encoding='utf-8').write(part)
    is_module = 'module' in (script_types.get(start_idx, '') or '')
    node_args = ['node', '--input-type=module'] if is_module else ['node', '--check', 'tmp_check.js']
    if is_module:
        r = subprocess.run(node_args, input=part, capture_output=True, text=True, encoding='utf-8', errors='replace')
    else:
        r = subprocess.run(node_args, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode == 0:
        print(f'  {name}: Syntax OK ({end_idx - start_idx} lines)')
    else:
        first_err = r.stderr.strip().split('\n')[0]
        print(f'  {name}: ERREUR -> {first_err}')
        print(r.stderr)
        all_ok = False
    os.remove('tmp_check.js')

print()
print('BILAN:', '✓ Tout OK' if all_ok else '✗ Des erreurs trouvees')
