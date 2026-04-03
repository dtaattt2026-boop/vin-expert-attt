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
          capabilities: ['saveVinReport', 'sendEmail', 'Drive archival']
        }))
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

  // Envoi email à l'agent (bouton "Envoyer rapport PDF par email")
  var agentEmailed = false;
  if (payload.sendToAgent && payload.agentEmail && pdfBlobForMail) {
    sendVinReportEmail({
      to: payload.agentEmail,
      subject: emailSubject,
      body: emailBody,
      metadataLines: metadataLines,
      pdfBlob: pdfBlobForMail,
      photoBlobs: photoBlobsForMail,
      agentName: agentName,
      pdfName: pdfName
    });
    agentEmailed = true;
  }

  return {
    ok: true,
    folder: agentFolder.getName(),
    reportFolder: reportFolder.getName(),
    files: (photos.length + (pdfBase64 ? 1 : 0)),
    emailed: shouldEmail && !!pdfBlobForMail,
    emailTo: shouldEmail && pdfBlobForMail ? REPORT_EMAIL_TO : '',
    agentEmailed: agentEmailed
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
