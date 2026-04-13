/**
 * ============================================================
 *  VIN Expert ATTT — Google Apps Script : Sauvegarde Drive
 * ============================================================
 *
 *  DÉPLOIEMENT :
 *  1. Ouvrir : https://script.google.com/
 *  2. Créer un nouveau projet (ou ouvrir l'existant)
 *  3. Remplacer TOUT le contenu par ce code
 *  4. Déployer → Nouveau déploiement :
 *       - Type : Application Web
 *       - Exécuter en tant que : Moi (dta.attt.2026@gmail.com)
 *       - Qui a accès : Tout le monde (même anonyme)
 *  5. Copier l'URL du déploiement et la mettre dans index.html
 *     à la constante GAS_DRIVE_URL
 *
 *  STRUCTURE créée dans Google Drive :
 *    Mon Drive/
 *      VIN_EXPERT/
 *        {nom_agent}/
 *          {VIN_YYYY-MM-DD_HH-mm-ss}/
 *            VIN-XXXXXXXXXXXXXXXXX-2025-01-15.pdf
 *            photo_1.jpg
 *            photo_2.jpg
 *            metadata.json
 *            resume.txt
 *
 *  ENVOI EMAIL AUTOMATIQUE :
 *    - Le rapport PDF est envoyé discrètement à dta.attt.2026@gmail.com
 *    - L'agent n'a aucune fenêtre Gmail à ouvrir
 * ============================================================
 */

var REPORT_EMAIL_TO = 'dta.attt.2026@gmail.com';
var LOG_SHEET_ID = null;  // Optional: for logging (set in doPost if sheet exists)

// ─── Base de référence VIN "BKA" — auto-gérée ───────────────
// Aucune configuration manuelle requise :
// Le sheet est créé automatiquement dans Drive/VIN_EXPERT/_REF_BKA/
// L'import du catalogue BKA est déclenché depuis le panneau admin.
var BKA_CATALOG_FOLDER_ID = '1jVi_jfZB3l4oyC4dlQGSeOMQnZCXGi6q';
var VIN_REF_SHEET_NAME    = 'VIN_REF_BKA';
var VIN_REF_PROP_KEY      = 'vinRefSheetId';

// ─── Helper: Log to Sheet (optional) ────────────────────────
function logEvent(action, details) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return;  // Not in a spreadsheet context
    var sheet = ss.getSheetByName('Logs') || ss.insertSheet('Logs');
    var now = new Date();
    sheet.appendRow([now, action, JSON.stringify(details || {})]);
  } catch(e) {
    // Silently fail if logging not available
  }
}

// ─── Point d'entrée GET (pour tests/diagnostic) ──────────────
function doGet(e) {
  try {
    var action = e.parameter.action || 'status';
    
    if (action === 'status') {
      return ContentService
        .createTextOutput(JSON.stringify({
          ok: true,
          message: 'VIN Expert GAS Backend v1.0',
          deployed: true,
          timestamp: new Date().toISOString(),
          capabilities: ['saveVinReport', 'sendEmail', 'Drive archival', 'lookupVinRef', 'lookupByMarque', 'initRefSheet', 'importBka', 'fetchVinExternal']
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'lookupVinRef') {
      var wmi = (e.parameter.wmi || '').toUpperCase().trim();
      if (!wmi || wmi.length < 2) {
        return ContentService
          .createTextOutput(JSON.stringify({ ok: false, error: 'WMI requis (min 2 caractères)' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService
        .createTextOutput(JSON.stringify(getVinRefData(wmi)))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'diagBka') {
      try {
        var folderId = e.parameter.folderId || BKA_CATALOG_FOLDER_ID;
        var folder;
        try { folder = DriveApp.getFolderById(folderId); } catch(ef) {
          return ContentService.createTextOutput(JSON.stringify({ ok:false, error:'Dossier inaccessible: '+ef.message })).setMimeType(ContentService.MimeType.JSON);
        }
        var diag = { ok:true, folderName: folder.getName(), files:[], subfolders:[], pages:[], picsCount:0, indexHtmlSnippet:'' };
        // Lister fichiers racine
        var fIt = folder.getFiles();
        while (fIt.hasNext()) { var f = fIt.next(); diag.files.push({ name:f.getName(), size:f.getSize() }); }
        // Lister sous-dossiers
        var dIt = folder.getFolders();
        while (dIt.hasNext()) { var d = dIt.next(); diag.subfolders.push(d.getName()); }
        // Index.html snippet
        var ixIt = folder.getFilesByName('index.html');
        if (ixIt.hasNext()) {
          var ix = ixIt.next().getBlob().getDataAsString('UTF-8');
          diag.indexHtmlSnippet = ix.substring(0, 800);
          diag.indexHtmlLength = ix.length;
        }
        // Pages folder
        var pgIt = folder.getFoldersByName('pages');
        if (pgIt.hasNext()) {
          var pg = pgIt.next(); var pgFiles = pg.getFiles(); var count = 0;
          while (pgFiles.hasNext() && count < 10) { var pf = pgFiles.next(); diag.pages.push(pf.getName()); count++; }
        }
        // Pics folder
        var piIt = folder.getFoldersByName('pics');
        if (piIt.hasNext()) { var pi = piIt.next(); var pfc = pi.getFiles(); while (pfc.hasNext()) { pfc.next(); diag.picsCount++; } }
        return ContentService.createTextOutput(JSON.stringify(diag)).setMimeType(ContentService.MimeType.JSON);
      } catch(err) {
        return ContentService.createTextOutput(JSON.stringify({ ok:false, error:err.message })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    if (action === 'lookupByMarque') {
      var marque = (e.parameter.marque || '').trim();
      if (!marque) {
        return ContentService
          .createTextOutput(JSON.stringify({ ok: false, error: 'Paramètre marque requis' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService
        .createTextOutput(JSON.stringify(getVinRefByMarque(marque)))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'initRefSheet') {
      try {
        var sheet = getOrCreateVinRefSheet();
        return ContentService
          .createTextOutput(JSON.stringify({ ok: true, message: 'Sheet VIN_REF_BKA prêt', rows: Math.max(0, sheet.getLastRow() - 1) }))
          .setMimeType(ContentService.MimeType.JSON);
      } catch(err) {
        return ContentService
          .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    if (action === 'importBka') {
      try {
        var folderId = e.parameter.folderId || BKA_CATALOG_FOLDER_ID;
        var result = importBkaCatalog(folderId);
        return ContentService
          .createTextOutput(JSON.stringify(result))
          .setMimeType(ContentService.MimeType.JSON);
      } catch(err) {
        return ContentService
          .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    if (action === 'getRefStats') {
      try {
        var sheet = getOrCreateVinRefSheet();
        var total = Math.max(0, sheet.getLastRow() - 1);
        return ContentService
          .createTextOutput(JSON.stringify({ ok: true, total: total, sheetName: VIN_REF_SHEET_NAME }))
          .setMimeType(ContentService.MimeType.JSON);
      } catch(err) {
        return ContentService
          .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    // ─── Proxy sources externes VIN (couleur, moteur, BV…) ──────
    if (action === 'fetchVinExternal') {
      var vin = (e.parameter.vin || '').replace(/[^A-HJ-NPR-Z0-9]/gi, '').toUpperCase();
      if (!vin || vin.length !== 17) {
        return ContentService
          .createTextOutput(JSON.stringify({ ok: false, error: 'VIN invalide' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService
        .createTextOutput(JSON.stringify(fetchVinExternalData(vin)))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: 'unknown GET action: ' + action }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: 'GET error: ' + err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ─── Point d'entrée POST ────────────────────────────────────
function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    logEvent('RECEIVED_POST', { action: payload.action, agentName: payload.agentName });

    if (payload.action === 'saveVinReport') {
      var result = saveVinReport(payload);
      logEvent('SAVE_VIN_REPORT_OK', result);
      return ContentService
        .createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (payload.action === 'saveChatPhoto') {
      var result = saveChatPhoto(payload);
      logEvent('SAVE_CHAT_PHOTO_OK', result);
      return ContentService
        .createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (payload.action === 'saveProjectBackup') {
      var result = saveProjectBackup(payload);
      logEvent('SAVE_PROJECT_BACKUP_OK', result);
      return ContentService
        .createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (payload.action === 'importBka') {
      try {
        var folderId = payload.folderId || BKA_CATALOG_FOLDER_ID;
        var result = importBkaCatalog(folderId);
        logEvent('IMPORT_BKA_OK', result);
        return ContentService
          .createTextOutput(JSON.stringify(result))
          .setMimeType(ContentService.MimeType.JSON);
      } catch(err) {
        return ContentService
          .createTextOutput(JSON.stringify({ ok: false, error: 'importBka: ' + err.message }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    if (payload.action === 'importBkaData') {
      try {
        var rows = payload.rows || [];  // [{wmi,marque,modele,anneeMin,anneeMax,motorisation,notes,statut}, ...]
        var mode = payload.mode || 'append';  // 'append' ou 'replace'
        var result = importBkaDataDirect(rows, mode);
        logEvent('IMPORT_BKA_DATA_OK', { count: result.written, mode: mode });
        return ContentService
          .createTextOutput(JSON.stringify(result))
          .setMimeType(ContentService.MimeType.JSON);
      } catch(err) {
        return ContentService
          .createTextOutput(JSON.stringify({ ok: false, error: 'importBkaData: ' + err.message }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    if (payload.action === 'clearBkaData') {
      try {
        var sheet = getOrCreateVinRefSheet();
        var lastRow = sheet.getLastRow();
        if (lastRow > 1) {
          sheet.deleteRows(2, lastRow - 1);
        }
        return ContentService
          .createTextOutput(JSON.stringify({ ok: true, cleared: lastRow - 1 }))
          .setMimeType(ContentService.MimeType.JSON);
      } catch(err) {
        return ContentService
          .createTextOutput(JSON.stringify({ ok: false, error: 'clearBkaData: ' + err.message }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    var errorMsg = 'action inconnue: ' + (payload.action || 'null');
    logEvent('UNKNOWN_ACTION', { action: payload.action });
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: errorMsg }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    logEvent('DOPOST_ERROR', { message: err.message, stack: err.stack });
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: 'doPost error: ' + err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ─── Sauvegarde VIN report ──────────────────────────────────
function saveVinReport(payload) {
  var agentName = (payload.agentName || 'Agent').replace(/[^a-zA-Z0-9_\- ]/g, '_');
  var pdfName   = payload.pdfName   || 'rapport.pdf';
  var pdfBase64 = payload.pdfBase64 || '';
  var photos    = payload.photos    || [];   // [{data: base64, name: photo_1.jpg}, ...]
  var metadata  = payload.metadata  || {};
  var reportFolderName = sanitizeName(payload.reportFolderName || pdfName.replace(/\.pdf$/i, ''));
  var emailSubject = payload.emailSubject || ('Rapport VIN Expert · ' + pdfName);
  var emailBody = payload.emailBody || 'Rapport VIN Expert ATTT en pièce jointe.';
  var metadataLines = payload.metadataLines || [];
  var shouldEmail = payload.sendEmail !== false;
  var pdfBlobForMail = null;
  var photoBlobsForMail = [];

  // ── Dossier racine VIN_EXPERT ──
  var rootFolder = getOrCreateFolder('VIN_EXPERT', DriveApp.getRootFolder());

  // ── Sous-dossier agent ──
  var agentFolder = getOrCreateFolder(agentName, rootFolder);

  // ── Sous-dossier rapport ──
  var reportFolder = getOrCreateFolder(reportFolderName, agentFolder);

  // ── Sauvegarder le PDF ──
  if (pdfBase64) {
    var pdfBytes = Utilities.base64Decode(pdfBase64);
    var pdfBlob  = Utilities.newBlob(pdfBytes, 'application/pdf', pdfName);
    pdfBlobForMail = pdfBlob.copyBlob();
    // Supprimer l'ancien fichier du même nom s'il existe
    var existing = reportFolder.getFilesByName(pdfName);
    while (existing.hasNext()) { existing.next().setTrashed(true); }
    reportFolder.createFile(pdfBlob);
  }

  // ── Sauvegarder les photos ──
  photos.forEach(function(photo) {
    if (!photo.data) return;
    try {
      var imgBytes = Utilities.base64Decode(photo.data);
      var imgBlob  = Utilities.newBlob(imgBytes, 'image/jpeg', photo.name);
      photoBlobsForMail.push(imgBlob.copyBlob());
      var existImg = reportFolder.getFilesByName(photo.name);
      while (existImg.hasNext()) { existImg.next().setTrashed(true); }
      reportFolder.createFile(imgBlob);
    } catch (ePhoto) {
      Logger.log('Photo error: ' + ePhoto.message);
    }
  });

  saveMetadataFiles(reportFolder, metadata, metadataLines);

  // Envoi email DTA (discret, automatique)
  if (shouldEmail && pdfBlobForMail && !payload.sendToAgent) {
    sendVinReportEmail({
      to: REPORT_EMAIL_TO,
      subject: emailSubject,
      body: emailBody,
      metadataLines: metadataLines,
      pdfBlob: pdfBlobForMail,
      photoBlobs: photoBlobsForMail,
      agentName: agentName,
      pdfName: pdfName
    });
  }

  // Envoi email à l'agent (auto après fullVerify ou bouton "Envoyer rapport PDF par email")
  var agentEmailed = false;
  if (payload.agentEmail && pdfBlobForMail) {
    sendVinReportEmail({
      to: payload.agentEmail,
      subject: emailSubject,
      body: payload.emailBody || ('Bonjour,\n\nVotre rapport VIN Expert est disponible en pièce jointe.\n\nCordialement,\nVIN Expert · ATTT'),
      metadataLines: metadataLines,
      pdfBlob: pdfBlobForMail.copyBlob(),
      photoBlobs: photoBlobsForMail.map(function(b){ return b.copyBlob(); }),
      agentName: agentName,
      pdfName: pdfName
    });
    agentEmailed = true;
  }

  // Envoi copie au supérieur hiérarchique (si demandé par l'admin)
  var superieurEmailed = false;
  if (payload.superieurEmail && pdfBlobForMail) {
    try {
      sendVinReportEmail({
        to: payload.superieurEmail,
        subject: '[Copie Supérieur] ' + emailSubject,
        body: 'Copie automatique transmise par VIN Expert ATTT.\n\n' + (payload.superieurNote || ''),
        metadataLines: metadataLines,
        pdfBlob: pdfBlobForMail.copyBlob(),
        photoBlobs: photoBlobsForMail.map(function(b){ return b.copyBlob(); }),
        agentName: agentName,
        pdfName: pdfName
      });
      superieurEmailed = true;
    } catch(eSup) {
      Logger.log('Erreur envoi supérieur: ' + eSup.message);
    }
  }

  return {
    ok: true,
    folder: agentFolder.getName(),
    reportFolder: reportFolder.getName(),
    files: (photos.length + (pdfBase64 ? 1 : 0)),
    emailed: shouldEmail && !!pdfBlobForMail,
    emailTo: shouldEmail && pdfBlobForMail ? REPORT_EMAIL_TO : '',
    agentEmailed: agentEmailed,
    superieurEmailed: superieurEmailed
  };
}

function saveMetadataFiles(folder, metadata, metadataLines) {
  var metadataJson = JSON.stringify(metadata || {}, null, 2);
  replaceTextFile(folder, 'metadata.json', metadataJson, 'application/json');

  var resume = [];
  if (Array.isArray(metadataLines) && metadataLines.length) {
    resume = metadataLines.slice();
  } else {
    Object.keys(metadata || {}).forEach(function(key) {
      resume.push(key + ': ' + metadata[key]);
    });
  }
  if (metadata && metadata.lienCarte) {
    resume.push('');
    resume.push('Carte: ' + metadata.lienCarte);
  }
  replaceTextFile(folder, 'resume.txt', resume.join('\n'), 'text/plain');
}

function replaceTextFile(folder, fileName, text, mimeType) {
  var existing = folder.getFilesByName(fileName);
  while (existing.hasNext()) { existing.next().setTrashed(true); }
  folder.createFile(Utilities.newBlob(text || '', mimeType || 'text/plain', fileName));
}

function sanitizeName(value) {
  return String(value || 'rapport')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'rapport';
}

function sendVinReportEmail(options) {
  var metadata = Array.isArray(options.metadataLines) ? options.metadataLines : [];
  var bodyLines = [
    'Rapport VIN Expert ATTT',
    '',
    'Transmission automatique et discrète depuis l\'application.',
    ''
  ].concat(metadata);

  if (options.body) {
    bodyLines.push('');
    bodyLines.push(options.body);
  }

  var attachments = [];
  if (options.pdfBlob) attachments.push(options.pdfBlob.setName(options.pdfName || 'rapport.pdf'));
  (options.photoBlobs || []).slice(0, 4).forEach(function(photoBlob, index) {
    if (!photoBlob) return;
    attachments.push(photoBlob.setName('photo_' + (index + 1) + '.jpg'));
  });

  MailApp.sendEmail({
    to: options.to,
    subject: options.subject,
    body: bodyLines.join('\n'),
    name: 'VIN Expert ATTT',
    attachments: attachments,
    noReply: true
  });
}

// ─── Utilitaire : créer ou récupérer un dossier ────────────
function getOrCreateFolder(name, parent) {
  var folders = parent.getFoldersByName(name);
  if (folders.hasNext()) return folders.next();
  return parent.createFolder(name);
}

// ─── Test manuel (exécuter depuis l'éditeur) ────────────────
function testSave() {
  var fakePayload = {
    action: 'saveVinReport',
    agentName: 'Test_Agent',
    pdfName: 'VIN-TEST12345678901.pdf',
    pdfBase64: '',  // vide pour le test
    photos: [],
    sendEmail: false,
    emailSubject: 'Test rapport VIN Expert',
    emailBody: 'Test local sans envoi effectif.',
    metadataLines: ['VIN: TEST12345678901'],
    metadata: {
      vin: 'TEST12345678901',
      agentNom: 'Test Agent',
      date: '2026-04-02 10:00:00',
      localisation: 'Non disponible'
    },
    reportFolderName: 'TEST12345678901_2026-04-02_10-00-00'
  };
  var res = saveVinReport(fakePayload);
  Logger.log(JSON.stringify(res));
}

// ─── Sauvegarde photo chat (copie admin discrète) ───────────
function saveChatPhoto(payload) {
  var agentName = (payload.agentName || 'Agent').replace(/[^a-zA-Z0-9_\- ]/g, '_');
  var photoBase64 = payload.photoBase64 || '';
  var photoName = payload.photoName || ('chat_' + new Date().toISOString().replace(/[:.]/g, '-') + '.jpg');

  var rootFolder = getOrCreateFolder('VIN_EXPERT', DriveApp.getRootFolder());
  var chatFolder = getOrCreateFolder('_CHAT_ARCHIVE', rootFolder);
  var agentChatFolder = getOrCreateFolder(agentName, chatFolder);

  if (photoBase64) {
    var imgBytes = Utilities.base64Decode(photoBase64);
    var imgBlob = Utilities.newBlob(imgBytes, 'image/jpeg', photoName);
    agentChatFolder.createFile(imgBlob);
  }

  return { ok: true, folder: '_CHAT_ARCHIVE/' + agentName, file: photoName };
}

// ─── Sauvegarde backup projet complet sur Drive ─────────────
function saveProjectBackup(payload) {
  var files = payload.files || [];  // [{name: 'index.html', content: base64, isBinary: bool}, ...]
  var version = payload.version || 'unknown';
  var timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  var rootFolder = getOrCreateFolder('VIN_EXPERT', DriveApp.getRootFolder());
  var backupRoot = getOrCreateFolder('_PROJECT_BACKUP', rootFolder);
  var versionFolder = getOrCreateFolder('v' + version + '_' + timestamp, backupRoot);

  var saved = 0;
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    if (!f.name || !f.content) continue;
    try {
      var safeName = f.name.replace(/[\/\\]/g, '_');
      if (f.isBinary) {
        var bytes = Utilities.base64Decode(f.content);
        var blob = Utilities.newBlob(bytes, 'application/octet-stream', safeName);
        versionFolder.createFile(blob);
      } else {
        var textBytes = Utilities.base64Decode(f.content);
        var text = Utilities.newBlob(textBytes).getDataAsString();
        versionFolder.createFile(safeName, text);
      }
      saved++;
    } catch(e) {
      // Skip file on error
    }
  }

  // Envoyer un email récapitulatif
  try {
    MailApp.sendEmail({
      to: REPORT_EMAIL_TO,
      subject: 'VIN Expert — Backup projet v' + version,
      body: 'Backup automatique du projet VIN Expert ATTT.\n\n' +
            'Version: ' + version + '\n' +
            'Date: ' + new Date().toLocaleString('fr-FR') + '\n' +
            'Fichiers sauvegardés: ' + saved + '/' + files.length + '\n' +
            'Dossier Drive: VIN_EXPERT/_PROJECT_BACKUP/v' + version + '_' + timestamp
    });
  } catch(e) {}

  return { ok: true, folder: '_PROJECT_BACKUP/v' + version + '_' + timestamp, filesSaved: saved, totalFiles: files.length };
}

// ─── Sheet VIN_REF_BKA : auto-création ──────────────────────
function getOrCreateVinRefSheet() {
  var props  = PropertiesService.getScriptProperties();
  var sheetId = props.getProperty(VIN_REF_PROP_KEY);
  if (sheetId) {
    try {
      var ss = SpreadsheetApp.openById(sheetId);
      var sh = ss.getSheetByName(VIN_REF_SHEET_NAME) || ss.getSheets()[0];
      if (sh) return sh;
    } catch(e) { /* sheet supprimé, recréer */ }
  }

  // Créer dans Drive/VIN_EXPERT/_REF_BKA/
  var rootFolder = getOrCreateFolder('VIN_EXPERT', DriveApp.getRootFolder());
  var refFolder  = getOrCreateFolder('_REF_BKA', rootFolder);

  var existingFiles = refFolder.getFilesByName(VIN_REF_SHEET_NAME);
  var ss;
  if (existingFiles.hasNext()) {
    ss = SpreadsheetApp.open(existingFiles.next());
  } else {
    ss = SpreadsheetApp.create(VIN_REF_SHEET_NAME);
    var ssFile = DriveApp.getFileById(ss.getId());
    refFolder.addFile(ssFile);
    DriveApp.getRootFolder().removeFile(ssFile);
  }

  var sheet = ss.getSheetByName(VIN_REF_SHEET_NAME) || ss.getActiveSheet();
  sheet.setName(VIN_REF_SHEET_NAME);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['WMI','Marque','Modèle','Année_min','Année_max','Motorisation','Photo_Drive_ID','Notes','Statut']);
    sheet.getRange(1,1,1,9).setFontWeight('bold').setBackground('#1a237e').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }

  props.setProperty(VIN_REF_PROP_KEY, ss.getId());
  return sheet;
}

// ─── Lookup par WMI ──────────────────────────────────────────
function getVinRefData(wmi) {
  try {
    var sheet = getOrCreateVinRefSheet();
    var data  = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var row    = data[i];
      var rowWmi = String(row[0] || '').toUpperCase().trim();
      if (!rowWmi) continue;
      if (rowWmi === wmi || (rowWmi.length >= 2 && wmi.startsWith(rowWmi))) {
        return buildRefResult(row);
      }
    }
    return { ok: true, found: false, wmi: wmi, message: 'WMI non trouvé dans la base BKA' };
  } catch(err) {
    return { ok: false, found: false, error: 'Erreur lookup WMI: ' + err.message };
  }
}

// ─── Lookup par Marque (fallback si WMI inconnu) ─────────────
function getVinRefByMarque(marque) {
  try {
    var sheet   = getOrCreateVinRefSheet();
    var data    = sheet.getDataRange().getValues();
    var needle  = marque.toLowerCase().trim();
    var results = [];
    for (var i = 1; i < data.length; i++) {
      var row       = data[i];
      var rowMarque = String(row[1] || '').toLowerCase().trim();
      if (rowMarque && (rowMarque === needle || rowMarque.indexOf(needle) >= 0 || needle.indexOf(rowMarque) >= 0)) {
        results.push(buildRefResult(row));
      }
    }
    if (results.length === 0) return { ok: true, found: false, marque: marque };
    return Object.assign(results[0], { found: true, variants: results.length });
  } catch(err) {
    return { ok: false, found: false, error: 'Erreur lookup marque: ' + err.message };
  }
}

function buildRefResult(row) {
  var photoId  = String(row[6] || '').trim();
  var photoUrl = photoId ? 'https://drive.google.com/thumbnail?id=' + photoId + '&sz=w400-h270' : '';
  return {
    ok: true, found: true,
    wmi: String(row[0] || '').trim(),
    marque: String(row[1] || '').trim(),
    modele: String(row[2] || '').trim(),
    anneeMin: String(row[3] || '').trim(),
    anneeMax: String(row[4] || '').trim(),
    motorisation: String(row[5] || '').trim(),
    photoId: photoId, photoUrl: photoUrl,
    notes: String(row[7] || '').trim(),
    statut: (String(row[8] || 'OK').trim().toUpperCase()) || 'OK'
  };
}

// ─── Import direct de données JSON dans VIN_REF_BKA ─────────
// payload.rows = [{wmi,marque,modele,anneeMin,anneeMax,motorisation,notes,statut}, ...]
// mode = 'append' (ajout) | 'replace' (efface d'abord)
function importBkaDataDirect(rows, mode) {
  var sheet = getOrCreateVinRefSheet();

  if (mode === 'replace') {
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.deleteRows(2, lastRow - 1);
    }
  }

  // Dé-dupliquer par WMI
  var existing = {};
  if (mode === 'append') {
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var w = String(data[i][0] || '').toUpperCase().trim();
      if (w) existing[w] = true;
    }
  }

  var toWrite = [];
  for (var j = 0; j < rows.length; j++) {
    var r = rows[j];
    var wmi = String(r.wmi || '').toUpperCase().trim();
    if (!wmi) continue;
    if (mode === 'append' && existing[wmi]) continue;
    existing[wmi] = true;
    toWrite.push([
      wmi,
      String(r.marque || '').trim(),
      String(r.modele || '').trim(),
      String(r.anneeMin || '').trim(),
      String(r.anneeMax || '').trim(),
      String(r.motorisation || '').trim(),
      String(r.photoId || '').trim(),
      String(r.notes || '').trim(),
      String(r.statut || 'OK').trim().toUpperCase()
    ]);
  }

  if (toWrite.length > 0) {
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, toWrite.length, 9).setValues(toWrite);
  }

  return {
    ok: true,
    written: toWrite.length,
    skipped: rows.length - toWrite.length,
    total: sheet.getLastRow() - 1,
    message: toWrite.length + ' entrées écrites, ' + (rows.length - toWrite.length) + ' doublons ignorés'
  };
}

// ─── Import catalogue BKA depuis Google Drive ────────────────
function importBkaCatalog(folderId) {
  var folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch(e) {
    return { ok: false, error: 'Dossier BKA inaccessible: ' + e.message };
  }

  var sheet = getOrCreateVinRefSheet();
  if (sheet.getLastRow() > 1) {
    sheet.deleteRows(2, sheet.getLastRow() - 1);
  }

  // ─ Photos (chercher pics/, Pics/, photos/, images/, img/ + racine)
  var picsIndex = {};
  var picsFolder = findFolderCI(folder, ['pics','photos','images','img','photo']);
  if (picsFolder) {
    var imgs = picsFolder.getFiles();
    while (imgs.hasNext()) {
      var img = imgs.next();
      var k = fileKey(img.getName());
      picsIndex[k] = img.getId();
    }
  }
  // Images dans la racine
  var rootIt = folder.getFiles();
  while (rootIt.hasNext()) {
    var rf = rootIt.next();
    if (rf.getName().match(/\.(jpe?g|png|gif|bmp|webp)$/i)) {
      picsIndex[fileKey(rf.getName())] = rf.getId();
    }
  }

  // ─ Collecte véhicules
  var vehicles = [];

  // 1. index.html
  var indexFile = findFileCI(folder, 'index.html');
  if (indexFile) {
    try {
      var html = indexFile.getBlob().getDataAsString('UTF-8');
      vehicles = vehicles.concat(parseVehicleIndex(html));
    } catch(e2) { Logger.log('index.html: ' + e2.message); }
  }

  // 2. Dossier pages/ (HTML + noms de fichiers)
  var pagesFolder = findFolderCI(folder, ['pages','page','vehicules','voitures','cars','auto','fiches','catalogue','liste']);
  if (pagesFolder) {
    var pf = pagesFolder.getFiles();
    var processed = 0;
    while (pf.hasNext() && processed < 300) {
      var f = pf.next();
      var vFromName = parseVehicleFromFilename(f.getName());
      if (f.getName().match(/\.(html?|htm)$/i)) {
        try {
          var content = f.getBlob().getDataAsString('UTF-8');
          var v = parseVehiclePage(content, f.getName());
          if (v && v.marque) { vehicles.push(v); } else if (vFromName) { vehicles.push(vFromName); }
        } catch(ep) { if (vFromName) vehicles.push(vFromName); }
      } else if (vFromName) {
        vehicles.push(vFromName);
      }
      processed++;
    }
  }

  // 3. Fallback : noms des images comme source de véhicules
  if (vehicles.length === 0 && Object.keys(picsIndex).length > 0) {
    for (var picKey in picsIndex) {
      var vPic = parseVehicleText(picKey.replace(/_/g, ' '));
      if (vPic && vPic.marque) {
        vPic.prelinkedPhotoId = picsIndex[picKey];
        vehicles.push(vPic);
      }
    }
  }

  // 4. Chercher dans TOUS les sous-dossiers si encore vide
  if (vehicles.length === 0) {
    var subIt = folder.getFolders();
    while (subIt.hasNext()) {
      var sub = subIt.next();
      var subFiles = sub.getFiles();
      var subCount = 0;
      while (subFiles.hasNext() && subCount < 200) {
        var sf = subFiles.next();
        var svFn = parseVehicleFromFilename(sf.getName());
        if (svFn) vehicles.push(svFn);
        if (sf.getName().match(/\.(html?|htm)$/i)) {
          try {
            var sc = sf.getBlob().getDataAsString('UTF-8');
            var sv = parseVehiclePage(sc, sf.getName());
            if (sv && sv.marque) { vehicles.pop(); vehicles.push(sv); }
          } catch(es) {}
        }
        subCount++;
      }
    }
  }

  // ─ Dédupliquer
  vehicles = deduplicateVehicles(vehicles);

  // ─ Attacher photos + WMI
  var marqueWmiMap = getMarqueWmiMap();
  var rows = [];
  vehicles.forEach(function(v) {
    var wmi = v.wmi || '';
    if (!wmi && v.marque) {
      var mk = v.marque.toLowerCase();
      for (var brand in marqueWmiMap) {
        if (mk.indexOf(brand) >= 0) { wmi = marqueWmiMap[brand]; break; }
      }
    }
    // Photo : essayer plusieurs clés de correspondance
    var photoId = v.prelinkedPhotoId || '';
    if (!photoId) {
      var candidates = [];
      if (v.marque && v.modele) candidates.push(fileKey(v.marque + '_' + v.modele));
      if (v.marque) candidates.push(fileKey(v.marque));
      if (v.modele) candidates.push(fileKey(v.modele));
      if (v.pageFile) candidates.push(fileKey(v.pageFile.replace(/\.[^.]+$/, '')));
      for (var ci = 0; ci < candidates.length && !photoId; ci++) {
        if (picsIndex[candidates[ci]]) { photoId = picsIndex[candidates[ci]]; break; }
        // correspondance partielle
        for (var pk in picsIndex) {
          if (pk.indexOf(candidates[ci]) >= 0 || candidates[ci].indexOf(pk) >= 0) {
            photoId = picsIndex[pk]; break;
          }
        }
      }
    }
    rows.push([
      wmi,
      v.marque || '',
      v.modele || '',
      v.anneeMin || '2012',
      v.anneeMax || '2013',
      v.motorisation || '',
      photoId,
      v.notes || '',
      v.statut || 'OK'
    ]);
  });

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, 9).setValues(rows);
    sheet.autoResizeColumns(1, 9);
  }

  return {
    ok: true,
    imported: rows.length,
    photos: Object.keys(picsIndex).length,
    picsFolder: picsFolder ? picsFolder.getName() : 'non trouvé',
    pagesFolder: pagesFolder ? pagesFolder.getName() : 'non trouvé',
    indexHtmlFound: !!indexFile,
    sheetName: VIN_REF_SHEET_NAME,
    message: rows.length + ' véhicule(s) importé(s) depuis la base BKA.'
  };
}

// ─── Helpers dossiers/fichiers (case-insensitive) ────────────
function findFolderCI(parent, names) {
  var list = Array.isArray(names) ? names : [names];
  for (var ni = 0; ni < list.length; ni++) {
    var variants = [list[ni], list[ni].charAt(0).toUpperCase() + list[ni].slice(1), list[ni].toUpperCase()];
    for (var vi = 0; vi < variants.length; vi++) {
      var it = parent.getFoldersByName(variants[vi]);
      if (it.hasNext()) return it.next();
    }
  }
  return null;
}

function findFileCI(parent, name) {
  var variants = [name, name.charAt(0).toUpperCase() + name.slice(1), name.toUpperCase()];
  for (var vi = 0; vi < variants.length; vi++) {
    var it = parent.getFilesByName(variants[vi]);
    if (it.hasNext()) return it.next();
  }
  return null;
}

function fileKey(name) {
  return String(name || '').replace(/\.[^.]+$/, '').toLowerCase().replace(/[-_\s\.]+/g, '_');
}

function parseVehicleFromFilename(filename) {
  var stem = filename.replace(/\.[^.]+$/, '').replace(/[-_\.]+/g, ' ').trim();
  if (!stem || stem.length < 3) return null;
  var v = parseVehicleText(stem);
  if (v && v.marque) { v.pageFile = filename; return v; }
  // Si pas de marque connue, prendre le premier mot comme marque
  var parts = stem.split(/\s+/);
  if (parts.length >= 1 && parts[0].length >= 2) {
    return { marque: capitalize(parts[0]), modele: parts.slice(1).join(' '), anneeMin: '2012', anneeMax: '2013', pageFile: filename };
  }
  return null;
}

// ─── Parsers HTML BKA ───────────────────────────────────────
function parseVehicleIndex(html) {
  var vehicles = [];
  // Extraire les entrées de liens + textes typiques d'un catalogue auto
  // Pattern: <a href="pages/xxx.html">Marque Modèle</a> ou <td>Marque</td><td>Modèle</td>
  var linkRe = /<a[^>]+href=["']([^"']*\.html?)['"'][^>]*>([\s\S]*?)<\/a>/gi;
  var match;
  while ((match = linkRe.exec(html)) !== null) {
    var href = match[1];
    var text = stripHtml(match[2]).trim();
    if (!text || text.length < 3) continue;
    var v = parseVehicleText(text);
    v.pageFile = href.split('/').pop();
    vehicles.push(v);
  }
  // Tableaux: <tr>…<td>Marque</td><td>Modèle</td>…</tr>
  var trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  while ((match = trRe.exec(html)) !== null) {
    var cells = [];
    var tdRe  = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    var tdM;
    while ((tdM = tdRe.exec(match[1])) !== null) {
      cells.push(stripHtml(tdM[1]).trim());
    }
    if (cells.length >= 2 && cells[0].length > 1) {
      var v2 = { marque: cells[0], modele: cells[1] || '' };
      if (cells[2]) v2.motorisation = cells[2];
      if (cells[3]) v2.anneeMin = cells[3];
      if (cells[4]) v2.anneeMax = cells[4];
      vehicles.push(v2);
    }
  }
  return vehicles;
}

function parseVehiclePage(html, fileName) {
  var v = { pageFile: fileName || '' };
  // Titre principal
  var titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleM) {
    var t = stripHtml(titleM[1]).trim();
    var parsed = parseVehicleText(t);
    Object.assign(v, parsed);
  }
  // H1/H2
  var hM = html.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/i);
  if (hM) {
    var hText = stripHtml(hM[1]).trim();
    var ph = parseVehicleText(hText);
    if (!v.marque && ph.marque) v.marque = ph.marque;
    if (!v.modele && ph.modele)  v.modele  = ph.modele;
  }
  // Tableaux de specs
  var trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  var match;
  while ((match = trRe.exec(html)) !== null) {
    var cells = [];
    var tdRe  = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
    var tdM;
    while ((tdM = tdRe.exec(match[1])) !== null) cells.push(stripHtml(tdM[1]).trim());
    if (cells.length >= 2) {
      var key = cells[0].toLowerCase();
      var val = cells[1];
      if (key.match(/marque|brand|make/))    v.marque      = v.marque || val;
      if (key.match(/mod.?le|model/))        v.modele      = v.modele || val;
      if (key.match(/ann.?e|year/))          v.anneeMin    = v.anneeMin || val.split('-')[0].trim();
      if (key.match(/mot.?u?r|engine|cyl/))  v.motorisation = v.motorisation || val;
      if (key.match(/vin|wmi|chassis/))      v.wmi         = v.wmi || val.substring(0,3).toUpperCase();
      if (key.match(/statut|status|alerte/)) v.statut      = val.toUpperCase();
      if (key.match(/notes?|remarques?/))    v.notes       = val;
    }
  }
  return (v.marque || v.modele) ? v : null;
}

// Extraire marque/modèle depuis un texte libre
function parseVehicleText(text) {
  var v = {};
  // Chercher une marque connue en début
  var knownBrands = ['toyota','hyundai','kia','volkswagen','renault','peugeot','citroen','fiat',
    'ford','chevrolet','nissan','mitsubishi','honda','mazda','suzuki','opel','seat','skoda',
    'audi','bmw','mercedes','dacia','lada','chery','geely','byd','mg','haval','dfsk','jac'];
  var lower = text.toLowerCase();
  for (var bi = 0; bi < knownBrands.length; bi++) {
    if (lower.indexOf(knownBrands[bi]) >= 0) {
      v.marque = capitalize(knownBrands[bi]);
      var rest = text.replace(new RegExp(knownBrands[bi], 'i'), '').trim();
      var yearM = rest.match(/\b(19|20)\d{2}\b/);
      if (yearM) { v.anneeMin = yearM[0]; rest = rest.replace(yearM[0], '').trim(); }
      v.modele = rest.replace(/[-–_|,;.]+/g,' ').trim().split(/\s{2,}/)[0].trim() || '';
      break;
    }
  }
  // Année standalone
  if (!v.anneeMin) {
    var yrM = text.match(/\b(19|20)\d{2}\b/);
    if (yrM) v.anneeMin = yrM[0];
  }
  if (!v.marque) v.marque = text.split(/[\s\-_|]/)[0];
  return v;
}

function deduplicateVehicles(vehicles) {
  var seen = {};
  return vehicles.filter(function(v) {
    var key = (v.marque + '|' + v.modele).toLowerCase().replace(/\s+/,'');
    if (seen[key] || !v.marque) return false;
    seen[key] = true;
    return true;
  });
}

function stripHtml(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ').replace(/&#\d+;/g,'').trim();
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// WMI standards pour marques courantes (marché tunisien)
function getMarqueWmiMap() {
  return {
    'toyota'     : 'JT2', 'hyundai'    : 'KMH', 'kia'        : 'KNA',
    'volkswagen' : 'WVW', 'renault'    : 'VF1', 'peugeot'    : 'VF3',
    'citroen'    : 'VF7', 'fiat'       : 'ZFA', 'ford'       : '1FA',
    'chevrolet'  : '1G1', 'nissan'     : 'JN1', 'mitsubishi' : 'JA3',
    'honda'      : 'JHM', 'mazda'      : 'JM1', 'suzuki'     : 'JS1',
    'opel'       : 'W0L', 'seat'       : 'VSS', 'skoda'      : 'TMB',
    'audi'       : 'WAU', 'bmw'        : 'WBA', 'mercedes'   : 'WDB',
    'dacia'      : 'UU1', 'lada'       : 'XTA', 'chery'      : 'LVV',
    'geely'      : 'LSG', 'mg'         : 'SAJ', 'haval'      : 'LHG',
    'dfsk'       : 'LDF', 'jac'        : 'LH1'
  };
}

// ─── Proxy sources externes VIN ─────────────────────────────
// Interroge carinfo.kiev.ua et sources complémentaires pour obtenir
// couleur, numéro de moteur/BV et autres informations véhicule.
function fetchVinExternalData(vin) {
  var result = {
    ok: false, found: false,
    couleur: null, numeroMoteur: null, numeroBv: null,
    autresInfos: [], source: null,
    note: null
  };

  // ── Source 1 : carinfo.kiev.ua (registre ukrainien) ──────────
  // Remarque : nécessite un CAPTCHA interactif pour afficher les données
  // du registre — le scraping direct est bloqué. Les données seront présentes
  // uniquement si le véhicule a été enregistré en Ukraine.
  try {
    var url1 = 'https://carinfo.kiev.ua/cars/vin?q=' + encodeURIComponent(vin);
    var resp1 = UrlFetchApp.fetch(url1, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    if (resp1.getResponseCode() === 200) {
      var html1 = resp1.getContentText('UTF-8');
      // Extraire couleur (plusieurs langues)
      var colorMatch = html1.match(/(?:Колір|Цвет|Color|Kolor)[^\:]*:\s*<[^>]+>([^<]{2,40})</i)
        || html1.match(/(?:Колір|Цвет|Color|Kolor)[^\:]*:[^\S\n]*([A-Za-zА-Яа-яÀ-ÿ ]{2,30})/i);
      if (colorMatch && colorMatch[1].replace(/\s/g,'').length > 1) result.couleur = colorMatch[1].trim();
      // Extraire numéro moteur
      var motorMatch = html1.match(/(?:Двигун|Двигатель|Engine\s*(?:No|Number|#))[^\:]*:\s*<[^>]+>([^<]{3,30})</i)
        || html1.match(/(?:motor|engine)\s*(?:no|number|serial|#)\s*[:\-]\s*([A-Z0-9\-]{3,25})/i);
      if (motorMatch) result.numeroMoteur = motorMatch[1].trim();
      // Extraire n° boîte vitesse
      var bvMatch = html1.match(/(?:Коробка\s*передач|Gearbox\s*(?:No|Number)|Transmission\s*(?:No|Serial))[^\:]*:\s*<[^>]+>([^<]{3,30})</i)
        || html1.match(/(?:gearbox|transmission)\s*(?:no|serial|#)\s*[:\-]\s*([A-Z0-9\-]{3,25})/i);
      if (bvMatch) result.numeroBv = bvMatch[1].trim();
      if (result.couleur || result.numeroMoteur || result.numeroBv) {
        result.ok = true;
        result.found = true;
        result.source = 'carinfo.kiev.ua';
      }
    }
  } catch(e1) { /* source 1 indisponible ou CAPTCHA */ }

  // ── Source 2 : NHTSA vPIC + vehicledatabases.com (fallback) ─
  // Double essai : NHTSA avec Referer en premier, puis vehicledatabases.com
  // si NHTSA est bloqué depuis les IPs Google Apps Script.
  if (!result.found) {
    var vpiSources = [
      {
        url: 'https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/' + encodeURIComponent(vin) + '?format=json',
        opts: { muteHttpExceptions: true, headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
          'Accept': 'application/json',
          'Referer': 'https://vpic.nhtsa.dot.gov/decoder/'
        }},
        label: 'NHTSA vPIC'
      },
      {
        url: 'https://api.vehicledatabases.com/vin-summary/' + encodeURIComponent(vin),
        opts: { muteHttpExceptions: true, headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Accept': 'application/json'
        }},
        label: 'VehicleDatabases'
      }
    ];
    for (var si = 0; si < vpiSources.length && !result.found; si++) {
      try {
        var resp2 = UrlFetchApp.fetch(vpiSources[si].url, vpiSources[si].opts);
        if (resp2.getResponseCode() === 200) {
          var json2 = JSON.parse(resp2.getContentText('UTF-8'));
          var r2 = Array.isArray(json2.Results) && json2.Results.length > 0 ? json2.Results[0] : {};
          var notEmpty = function(v) { return v && v !== 'Not Applicable' && v !== '0' && v.trim() !== ''; };
          var infos = [];
          if (notEmpty(r2.EngineConfiguration))  infos.push('Configuration moteur: ' + r2.EngineConfiguration);
          if (notEmpty(r2.EngineManufacturer))   infos.push('Fabricant moteur: ' + r2.EngineManufacturer);
          if (notEmpty(r2.EngineModel))          infos.push('Code moteur: ' + r2.EngineModel);
          if (notEmpty(r2.EngineCylinders))      infos.push('Cylindres: ' + r2.EngineCylinders);
          if (notEmpty(r2.EngineHP))             infos.push('Puissance moteur: ' + r2.EngineHP + ' ch');
          if (notEmpty(r2.DisplacementL))        infos.push('Cylindrée: ' + r2.DisplacementL + ' L');
          if (notEmpty(r2.FuelTypePrimary))      infos.push('Carburant: ' + r2.FuelTypePrimary);
          if (notEmpty(r2.Turbo) && r2.Turbo.toLowerCase() === 'yes') infos.push('Turbo: Oui');
          if (notEmpty(r2.TransmissionStyle))    infos.push('Type BV: ' + r2.TransmissionStyle);
          if (notEmpty(r2.TransmissionSpeeds))   infos.push('Rapports BV: ' + r2.TransmissionSpeeds);
          if (notEmpty(r2.DriveType))            infos.push('Transmission: ' + r2.DriveType);
          if (notEmpty(r2.BodyClass))            infos.push('Carrosserie: ' + r2.BodyClass);
          if (notEmpty(r2.Doors))                infos.push('Portes: ' + r2.Doors);
          if (notEmpty(r2.Series))               infos.push('Série: ' + r2.Series);
          if (notEmpty(r2.Trim))                 infos.push('Finition: ' + r2.Trim);
          if (notEmpty(r2.PlantCountry))         infos.push('Assemblé en: ' + r2.PlantCountry + (notEmpty(r2.PlantCity) ? ' / ' + r2.PlantCity : ''));
          if (infos.length > 0) {
            result.autresInfos = infos;
            result.ok = true;
            result.found = true;
            result.source = vpiSources[si].label + ' (specs techniques)';
          }
        }
      } catch(e2i) { /* source indisponible */ }
    }
  }

  // ── Note importante ──────────────────────────────────────────
  // La couleur réelle, le n° de série moteur et le n° de série BV
  // sont des données physiques du véhicule non encodées dans le VIN.
  // Ces informations se trouvent dans la carte grise ou les bases
  // nationales (SIVAT/BDR Tunisie).
  if (!result.couleur)     result.note = (result.note || '') + 'Couleur : disponible uniquement sur la carte grise. ';
  if (!result.numeroMoteur) result.note = (result.note || '') + 'N° moteur/BV : données physiques non accessibles via API publique (voir carte grise). ';

  return result;
}
