const payload = {
  action: 'saveVinReport',
  agentName: 'Agent_Test',
  pdfBase64: 'JVBERi0xLjQ=',
  pdfName: 'VIN-TEST.pdf',
  photos: [{ data: '/9j/4AAQ', name: 'photo_1.jpg' }],
  reportFolderName: 'VINTEST_2026-04-02_10-00-00',
  metadata: {
    vin: 'TESTVIN123456789',
    agentNom: 'Test Agent',
    date: '02/04/2026 10:00:00',
    localisation: 'Lat 36.800000, Lng 10.180000, précision ±15 m',
    lienCarte: 'https://maps.google.com/?q=36.8,10.18',
    ocrMode: 'web',
    ocrSource: 'Zone VIN',
    doubleScanConfirme: true
  },
  sendEmail: true,
  emailSubject: 'Rapport VIN Expert · TEST',
  emailBody: 'Rapport transmis automatiquement à la DTA depuis VIN Expert.',
  metadataLines: [
    'Agent: Test Agent',
    'VIN: TESTVIN123456789',
    'Statut: CHÂSSIS VALIDE'
  ]
};

const json = JSON.stringify(payload);
const parsed = JSON.parse(json);

const ok = parsed.sendEmail === true
  && parsed.emailSubject.includes('Rapport VIN Expert')
  && parsed.metadataLines.length === 3
  && parsed.photos[0].name === 'photo_1.jpg'
  && parsed.reportFolderName.includes('VINTEST')
  && parsed.metadata.localisation.includes('Lat')
  && parsed.metadata.lienCarte.includes('maps.google.com')
  && parsed.metadata.doubleScanConfirme === true;

console.log(ok ? 'PASS - payload automatique discret OK' : 'FAIL - payload automatique discret invalide');
if (!ok) process.exit(1);
