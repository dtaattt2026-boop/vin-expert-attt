#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
BKA Import — VIN Expert ATTT
Parse les fichiers HTML du CD BKA 2012-2013 + base WMI étendue
Envoie les données vers GAS pour peupler la fiche VIN_REF_BKA

Usage: python _bka_import.py [--replace]
  --replace : efface d'abord les données existantes
"""

import re
import os
import sys
import json
import urllib.request
import urllib.error

# ─── CONFIG ────────────────────────────────────────────────────────────────────
GAS_URL  = "https://script.google.com/macros/s/AKfycbwJu4hNrvh3e9_sT9GcQ8Q2CMWo3kC64F2n7RVCmM1gjQtnHbud9k-FPV3piRfSgUxC/exec"
BKA_BASE = r"X:\ATTT\CD BKA 2012-2013-20260408T183214Z-3-001\CD BKA 2012-2013\pages\francais"
BATCH    = 50   # Nombre de lignes par requête POST
MODE     = "replace" if "--replace" in sys.argv else "append"

# ─── BASE WMI ÉTENDUE ──────────────────────────────────────────────────────────
# Sources: NHTSA WMI DB, ISO 3780, données publiques constructeurs
# Format: (WMI, Marque, Pays/Région, Modèle_défaut, Années)
WMI_DB = [
    # === EUROPE ===
    # Allemagne
    ("WBA", "BMW",              "Allemagne",    "Série (berlines)",         "2000-2024"),
    ("WBS", "BMW M",            "Allemagne",    "M Series",                 "2005-2024"),
    ("WBX", "BMW X",            "Allemagne",    "X Series (SAV)",           "1999-2024"),
    ("WBY", "BMW",              "Allemagne",    "Électrique (i3/i4/iX)",    "2013-2024"),
    ("4US", "BMW",              "USA",          "BMW USA",                  "2000-2024"),
    ("WDB", "Mercedes-Benz",    "Allemagne",    "Classe (berlines)",        "1998-2024"),
    ("WDD", "Mercedes-Benz",    "Allemagne",    "Classe (SUV/Compact)",     "2004-2024"),
    ("WDC", "Mercedes-Benz",    "Allemagne",    "GLK/GLC/GLE",              "2008-2024"),
    ("WDF", "Mercedes-Benz",    "Allemagne",    "Sprinter/Vito",            "2000-2024"),
    ("WME", "Smart",            "Allemagne",    "ForTwo/ForFour",           "1998-2024"),
    ("WAU", "Audi AG",          "Allemagne",    "Série (berlines/CUV)",     "1993-2024"),
    ("WVW", "Volkswagen",       "Allemagne",    "Golf/Passat/Polo",         "1979-2024"),
    ("WV1", "Volkswagen",       "Allemagne",    "Véhicule commercial",      "2000-2024"),
    ("WV2", "Volkswagen",       "Allemagne",    "Transporter/Bus",          "1991-2024"),
    ("WV3", "Volkswagen",       "Allemagne",    "MAN (camion)",             "1998-2024"),
    ("WP0", "Porsche",          "Allemagne",    "911/Cayenne/Panamera",     "1999-2024"),
    ("WP1", "Porsche",          "Allemagne",    "Macan/Cayenne",            "2002-2024"),
    ("WUA", "Audi Quattro GmbH","Allemagne",    "RS/S Series",              "1994-2024"),
    ("TRU", "Audi",             "Hongrie",      "TT/A3 (usine Gyor)",       "2006-2024"),
    ("VSS", "SEAT",             "Espagne",      "Ibiza/Leon/Ateca",         "1993-2024"),
    ("VS6", "SEAT",             "Espagne",      "Alhambra/Altea",           "1996-2024"),
    ("VS7", "SEAT",             "Espagne",      "SEAT Espagne",             "2000-2024"),
    ("TMB", "Škoda",            "Rép. tchèque", "Octavia/Fabia/Superb",     "1996-2024"),
    ("TM9", "Škoda",            "Rép. tchèque", "Citigo/Yeti/Kodiaq",      "2005-2024"),
    ("VIN", "Volkswagen",       "Mexique",      "VW Mexique",               "1993-2024"),
    ("WBA6", "Alpina",          "Allemagne",    "B3/B4/B5/B7",              "2003-2024"),
    ("SAJ", "Jaguar",           "Royaume-Uni",  "XJ/XF/XE/F-Type",         "1979-2024"),
    ("SAL", "Land Rover",       "Royaume-Uni",  "Discovery/Defender/Range", "1979-2024"),
    ("SCA", "Rolls-Royce",      "Royaume-Uni",  "Phantom/Ghost/Wraith",     "1980-2024"),
    ("SCB", "Bentley",          "Royaume-Uni",  "Continental/Mulsanne",     "1980-2024"),
    ("SCF", "Aston Martin",     "Royaume-Uni",  "DB/Vantage/DBS",           "2000-2024"),
    ("SCC", "Lotus Cars",       "Royaume-Uni",  "Elise/Evora/Emira",        "1996-2024"),
    ("SHH", "Honda UK",         "Royaume-Uni",  "Civic/Jazz/CR-V",          "1994-2024"),
    ("SHL", "Honda UK",         "Royaume-Uni",  "Honda UK",                 "2000-2024"),
    ("VF1", "Renault",          "France",       "Clio/Mégane/Laguna",       "1988-2024"),
    ("VF3", "Peugeot",          "France",       "206/207/208/308",          "1988-2024"),
    ("VF6", "Renault/Trucks",   "France",       "Renault Trucks",           "1998-2024"),
    ("VF7", "Citroën",          "France",       "C3/C4/C5/Berlingo",        "1988-2024"),
    ("VF8", "Matra",            "France",       "Espace (ancienne dénom.)", "1990-2002"),
    ("VFA", "Renault",          "France",       "Renault Sport",            "2002-2024"),
    ("VNK", "Toyota",           "France",       "Yaris (usine Valenciennes)","2001-2024"),
    ("VS5", "Škoda",            "Espagne",      "Škoda Espagne",            "1996-2014"),
    ("VSK", "Opel/Vauxhall",    "Espagne",      "Opel Espagne",             "2000-2024"),
    ("W0L", "Opel/Vauxhall",    "Allemagne",    "Astra/Corsa/Zafira",       "1980-2024"),
    ("WOL", "Opel/Vauxhall",    "Allemagne",    "Opel/Insignia",            "1989-2024"),
    ("WOLX", "Opel",            "Allemagne",    "Opel (général)",           "2000-2024"),
    ("XL9", "Spyker Cars",      "Pays-Bas",     "Spyker",                   "2000-2018"),
    ("XLR", "DAF/VDL",          "Pays-Bas",     "Bus/Car",                  "1990-2024"),
    ("YVW", "Volkswagen",       "Belgique",     "VW Forest (Belgique)",     "1992-2006"),
    ("YV1", "Volvo Cars",       "Suède",        "S40/S60/S80/V70/XC70",     "1992-2024"),
    ("YV3", "Volvo Trucks",     "Suède",        "Camion Volvo",             "1990-2024"),
    ("YV4", "Volvo Cars",       "Suède",        "XC40/XC60/XC90",           "2001-2024"),
    ("ZAR", "Alfa Romeo",       "Italie",       "Giulia/Stelvio/147/156",   "1992-2024"),
    ("ZCF", "Fiat/Iveco",       "Italie",       "Daily/Ducato/Stralis",     "1996-2024"),
    ("ZFF", "Ferrari",          "Italie",       "F8/Roma/SF90/488",         "1980-2024"),
    ("ZHW", "Lamborghini",      "Italie",       "Huracán/Urus/Aventador",   "1998-2024"),
    ("ZLA", "Lancia",           "Italie",       "Delta/Ypsilon/Musa",       "1990-2010"),
    ("ZAA", "Alfa Romeo",       "Italie",       "Alfa Romeo (général)",     "1984-2000"),
    ("ZCG", "Fiat",             "Italie",       "Fiat (Italie)",            "1980-2024"),
    ("ZEA", "Fiat",             "Italie",       "Panda/Punto/500",          "1996-2024"),
    ("ZLM", "Maserati",         "Italie",       "Ghibli/Quattroporte/Levante","2001-2024"),
    ("ZNF", "Iveco",            "Italie",       "Iveco (camion/fourgon)",    "1994-2024"),
    ("NMT", "Toyota",           "Turquie",      "Toyota Turquie",           "2001-2024"),
    ("NM0", "Ford",             "Turquie",      "Ford Transit Connect",     "2002-2024"),
    ("TBA", "Hyundai",          "République tchèque","i30/Tucson (CZ)",      "2007-2024"),
    ("TK9", "Kia",              "Slovaquie",    "Sportage/Ceed",            "2006-2024"),
    ("TMA", "Hyundai",          "Rép. tchèque", "i30/Kona (CZ)",            "2008-2024"),
    ("U5Y", "Kia",              "Slovaquie",    "Sportage/Ceed/Stinger",    "2007-2024"),
    ("VF0", "Citroën",          "France",       "Citroën (général)",        "1988-2010"),
    ("WF0", "Ford",             "Allemagne",    "Mondeo/Transit (DE)",      "1994-2019"),
    ("WF8", "Ford",             "Allemagne",    "Focus/Kuga (Sarrelouis)",   "2000-2024"),
    ("WFO", "Ford",             "Allemagne",    "Ford Allemagne",           "1993-2015"),

    # === ASIE / JAPON ===
    ("JHM", "Honda",            "Japon",        "Accord/CR-V/HR-V",         "1981-2024"),
    ("JHL", "Honda",            "Japon",        "Odyssey/Pilot/Ridgeline",  "1994-2024"),
    ("JN1", "Nissan",           "Japon",        "Micra/Note/Qashqai",       "1990-2024"),
    ("JN8", "Nissan",           "Japon",        "X-Trail/Juke/Murano",      "2001-2024"),
    ("JN3", "Infiniti",         "Japon",        "Infiniti Q/QX",            "2003-2024"),
    ("JM1", "Mazda",            "Japon",        "CX-5/3/6/MX-5",            "1991-2024"),
    ("JMB", "Mitsubishi",       "Japon",        "Outlander/ASX/Eclipse",    "1990-2024"),
    ("JMY", "Mitsubishi",       "Japon",        "Mitsubishi (général)",     "1993-2012"),
    ("JMP", "Mitsubishi",       "Japon",        "Mitsubishi Trucks",        "1990-2024"),
    ("JS1", "Suzuki",           "Japon",        "Swift/Vitara/SX4",         "1985-2024"),
    ("JSA", "Suzuki",           "Japon",        "Suzuki Moto",              "1990-2024"),
    ("JSD", "Daihatsu",         "Japon",        "Terios/Sirion",            "1988-2024"),
    ("JT1", "Toyota",           "Japon",        "Yaris/Corolla (Japon)",    "1980-2024"),
    ("JTD", "Toyota",           "Japon",        "Land Cruiser/HiAce",       "1989-2024"),
    ("JTE", "Toyota",           "Japon",        "RAV4/Highlander",          "1994-2024"),
    ("JTF", "Toyota",           "Japon",        "Prius/Auris/Verso",        "1997-2024"),
    ("JTG", "Toyota",           "Japon",        "Avensis/Camry",            "1998-2024"),
    ("JTH", "Lexus",            "Japon",        "IS/ES/LS/GS/RX",           "1990-2024"),
    ("JTJ", "Lexus",            "Japon",        "GX/LX/NX/UX",              "2004-2024"),
    ("JY1", "Yamaha",           "Japon",        "Yamaha Moto",              "1990-2024"),
    ("JKA", "Kawasaki",         "Japon",        "Kawasaki Moto",            "1990-2024"),
    ("JS2", "Suzuki",           "Japon",        "Suzuki Moto (2)",          "1990-2024"),
    ("JH2", "Honda Moto",       "Japon",        "Honda Moto",               "1990-2024"),
    ("JH4", "Acura",            "Japon",        "Acura MDX/TLX/RDX",        "1986-2024"),
    ("KMH", "Hyundai",          "Corée du Sud", "i10/i20/i30/Tucson/Santa Fe","1990-2024"),
    ("KMJ", "Hyundai",          "Corée du Sud", "Genesis/Sonata/Elantra",   "2000-2024"),
    ("KNA", "Kia",              "Corée du Sud", "Picanto/Rio/Cee'd/Sportage","1992-2024"),
    ("KND", "Kia",              "Corée du Sud", "Sorento/Stinger/EV6",      "2000-2024"),
    ("KNM", "Renault Korea",    "Corée du Sud", "QM6/SM6 (Renault Samsung)","2000-2024"),
    ("KPA", "SsangYong",        "Corée du Sud", "Rexton/Korando/Tivoli",    "1992-2020"),
    ("KL1", "Daewoo/Chevrolet", "Corée du Sud", "Matiz/Lacetti/Cruze",      "1992-2024"),
    ("KL4", "Buick/GM Korea",   "Corée du Sud", "Buick Enclave (Korea)",    "2001-2024"),
    ("MBH", "Honda",            "Thaïlande",    "City/Jazz/BR-V (TH)",      "1999-2024"),
    ("MHF", "Toyota",           "Thaïlande",    "Yaris/Vios/Fortuner",      "1999-2024"),
    ("MNB", "Toyota",           "Thaïlande",    "Hilux/Camry (TH)",         "1998-2024"),
    ("MRH", "Honda",            "Thaïlande",    "HR-V/CR-V (TH)",           "2001-2024"),
    ("MR0", "Toyota",           "Thaïlande",    "Toyota (TH général)",      "1999-2020"),
    ("JS3", "Suzuki",           "Japon",        "Jimny/Grand Vitara",        "1990-2024"),
    ("NLA", "Honda",            "Belgique",     "Civic (usine Gand)",       "2003-2010"),

    # === AMÉRIQUE ===
    ("1FA", "Ford",             "USA",          "Mustang (FA=Passenger)",   "1980-2024"),
    ("1FT", "Ford",             "USA",          "F-150/F-250/Ranger",       "1980-2024"),
    ("1G1", "Chevrolet",        "USA",          "Malibu/Spark/Trax",        "1980-2024"),
    ("1GC", "Chevrolet",        "USA",          "Silverado (camionnette)",  "1980-2024"),
    ("1GT", "GMC",              "USA",          "Sierra/Terrain/Acadia",    "1992-2024"),
    ("1HD", "Harley-Davidson",  "USA",          "Harley-Davidson Moto",     "1981-2024"),
    ("1HG", "Honda",            "USA",          "Accord/Civic (Marysville)","1982-2024"),
    ("1N4", "Nissan",           "USA",          "Altima/Leaf (Smyrna)",     "1980-2024"),
    ("1NX", "Toyota",           "USA",          "Camry/Corolla (Georgetown)","1988-2024"),
    ("1VW", "Volkswagen",       "USA",          "VW USA (Chattanooga)",     "2011-2024"),
    ("1YV", "Mazda",            "USA",          "Mazda (Flatrock USA)",     "1988-2024"),
    ("2G1", "Chevrolet",        "Canada",       "Impala (Canada)",          "1990-2024"),
    ("2T1", "Toyota",           "Canada",       "Corolla (Cambridge)",       "1988-2024"),
    ("3FA", "Ford",             "Mexique",      "Fusion (Hermosillo)",       "2005-2024"),
    ("3VW", "Volkswagen",       "Mexique",      "VW Puebla (Jetta/Beetle)", "1980-2024"),
    ("4T1", "Toyota",           "USA",          "Camry (Georgetown)",        "1988-2024"),
    ("4US", "BMW",              "USA",          "BMW Spartanburg (X3-X7)",  "1999-2024"),
    ("5FN", "Honda",            "USA",          "Pilot/Odyssey/Ridgeline",  "2001-2024"),
    ("5TE", "Toyota",           "USA",          "Tundra (San Antonio)",     "2004-2024"),
    ("5YJ", "Tesla",            "USA",          "Model S/X/3/Y",            "2012-2024"),
    ("7SA", "Tesla",            "USA",          "Tesla Model S",            "2020-2024"),
    ("SB1", "Toyota",           "Royaume-Uni",  "Yaris/Auris (Burnaston)",  "1992-2024"),

    # === AFRIQUE / MOYEN-ORIENT ===
    ("6FP", "Ford",             "Australie",    "Territory (Broadmeadows)", "2003-2016"),
    ("6MM", "Mitsubishi",       "Australie",    "Mitsubishi Australie",     "1989-2005"),
    ("AA9", "Hyundai",          "Afrique du Sud","i20/Grand i10 (SA)",      "2010-2024"),
    ("AAV", "Volkswagen",       "Afrique du Sud","Polo/Citi Golf/Tiguan",   "1980-2024"),
    ("AB1", "Toyota",           "Afrique du Sud","Hilux/Fortuner/Corolla",  "1980-2024"),

    # === CONSTRUCTEURS SPÉCIAUX (Tunisie/Maghreb vus en pratique) ===
    ("VF1", "Renault",          "France",       "Clio/Symbol/Megane/Duster","1988-2024"),
    ("VF3", "Peugeot",          "France",       "206/207/208/301/308/508",  "1988-2024"),
    ("VF7", "Citroën",          "France",       "C3/C4/C5/Xsara/Berlingo", "1988-2024"),
]

# ─── PARSE DES FICHIERS BKA HTML ───────────────────────────────────────────────
def read_html(path):
    with open(path, encoding='cp1252', errors='replace') as f:
        return f.read()

def html_to_text(html):
    t = re.sub(r'<[^>]+>', ' ', html)
    t = re.sub(r'&nbsp;', ' ', t)
    t = re.sub(r'&eacute;', 'é', t)
    t = re.sub(r'&agrave;', 'à', t)
    t = re.sub(r'&acirc;', 'â', t)
    t = re.sub(r'&[a-zA-Z0-9#]+;', ' ', t)
    return re.sub(r'\s+', ' ', t).strip()

def extract_vin_prefixes(html):
    """Extraire les WMI (3 premiers chars) des numéros de châssis VIN."""
    # Pattern: 17 chars VIN ou au moins 10 chars alphanumériques type châssis
    vins = re.findall(r'\b([A-HJ-NPR-Z0-9]{3}[A-HJ-NPR-Z0-9]{5,})\b', html)
    wmis = {}
    for v in vins:
        wmi = v[:3]
        if not wmi.isdigit() and re.match(r'^[A-Z0-9]{3}$', wmi):
            wmis[wmi] = wmis.get(wmi, 0) + 1
    # Retourner le WMI le plus fréquent
    if wmis:
        best = sorted(wmis.items(), key=lambda x: -x[1])[0][0]
        return best
    return None

def brand_from_path(relpath):
    """Extraire la marque depuis le chemin car/[brand][type]/xxx.htm."""
    parts = relpath.replace('\\', '/').split('/')
    folder = parts[-2] if len(parts) >= 2 else ''
    # Enlever les suffixes de type
    brand = re.sub(r'(fin|typ|gkb|mkb|vers|get|mot|farb|abi|vin|abw|mkl)', '', folder, flags=re.IGNORECASE)
    brand_map = {
        'audi': 'Audi', 'bmw': 'BMW', 'vw': 'Volkswagen', 'skoda': 'Škoda',
        'seat': 'SEAT', 'honda': 'Honda', 'merc': 'Mercedes-Benz', 'mer': 'Mercedes-Benz',
        'por': 'Porsche', 'ren': 'Renault', 'cit': 'Citroën', 'peu': 'Peugeot',
        'peugeot': 'Peugeot', 'ford': 'Ford', 'opel': 'Opel', 'sub': 'Subaru',
        'suz': 'Suzuki', 'nis': 'Nissan', 'toy': 'Toyota', 'hyun': 'Hyundai',
        'kia': 'Kia', 'vol': 'Volvo', 'vag': 'VAG (Groupe VW)',
        'april': 'Aprilia', 'smart': 'Smart', 'dacia': 'Dacia', 'mits': 'Mitsubishi',
        'mitsu': 'Mitsubishi', 'may': 'Maybach', 'roll': 'Rolls-Royce',
        'rover': 'Land Rover', 'jag': 'Jaguar', 'lanc': 'Lancia',
        'alfa': 'Alfa Romeo', 'fiat': 'Fiat', 'saab': 'Saab',
        'ssang': 'SsangYong', 'lexus': 'Lexus', 'infini': 'Infiniti',
        'volvo': 'Volvo', 'bentl': 'Bentley', 'aston': 'Aston Martin',
        'bugat': 'Bugatti', 'porsche': 'Porsche', 'lamborg': 'Lamborghini',
        'mase': 'Maserati', 'chev': 'Chevrolet', 'chry': 'Chrysler',
        'mini': 'MINI', 'mazda': 'Mazda', 'hum': 'Hummer', 'dacia': 'Dacia',
    }
    b = brand.lower().strip()
    for key, val in brand_map.items():
        if b == key or b.startswith(key):
            return val
    return brand.capitalize() if brand else None

def parse_bka_files():
    """Parser tous les fichiers HTM français et extraire les données véhicules."""
    rows = []
    seen = set()

    for dirpath, dirnames, filenames in os.walk(BKA_BASE):
        for fn in filenames:
            if not fn.endswith('.htm'):
                continue
            path = os.path.join(dirpath, fn)
            relpath = path[len(BKA_BASE)+1:]

            # Ignorer les fichiers de styles/scripts
            rlow = relpath.lower()
            if 'styles' in rlow or 'scripts' in rlow or 'images' in rlow:
                continue

            try:
                html = read_html(path)
            except Exception as e:
                print(f"  ⚠ Impossible de lire {relpath}: {e}")
                continue

            text = html_to_text(html)

            # Titre
            title_m = re.search(r'<title>([^<]+)</title>', html, re.IGNORECASE)
            title = html_to_text(title_m.group(1)) if title_m else fn.replace('.htm', '')

            # Marque
            marque = brand_from_path(relpath)
            if not marque:
                continue

            # WMI depuis les VINs dans le fichier
            wmi = extract_vin_prefixes(html)

            # Motorisation: chercher les mentions de cylindrée/moteur
            moteurs = []
            for m in re.finditer(r'\b(\d{3,4}\s*(?:DOHC|SOHC|VTEC|TDI|CDI|FSI|TSI|HDi|VTi|dCi|BlueHDi|THP|GTDi|EcoBoost|Diesel|Essence|Turbo|Hybride?)?)\b', text, re.IGNORECASE):
                val = m.group(1).strip()
                if len(val) >= 3 and val not in moteurs:
                    moteurs.append(val)

            # Années: chercher les années dans le texte
            annees = re.findall(r'\b(19[89]\d|20[012]\d)\b', text)
            annee_min = min(annees) if annees else '2006'
            annee_max = max(annees) if annees else '2013'

            # Modèle depuis le titre
            modele = title

            # Catégorie (voiture, camion, moto)
            parts = relpath.replace('\\', '/').split('/')
            categorie = ''
            if 'car' in parts:    categorie = 'VP'
            elif 'lkw' in parts:  categorie = 'VUL'
            elif 'mr' in parts:   categorie = 'Moto'
            elif 'bus' in parts:  categorie = 'Bus'

            # Type de fiche
            folder = parts[-2] if len(parts) >= 2 else ''
            ftype = ''
            if 'mkb' in folder or 'mot' in folder:  ftype = 'Codes moteur'
            elif 'gkb' in folder or 'get' in folder: ftype = 'Codes boîte'
            elif 'typ' in folder:                     ftype = 'Types/modèles'
            elif 'fin' in folder:                     ftype = 'Finitions'
            elif 'vers' in folder:                    ftype = 'Versions'
            elif 'farb' in folder:                    ftype = 'Codes couleur'

            notes = f"BKA 2012-2013 | {categorie} | {ftype} | {fn}"
            motorisation = ' / '.join(moteurs[:3]) if moteurs else ''

            # Si pas de WMI depuis le fichier, chercher dans la base WMI
            if not wmi:
                for entry in WMI_DB:
                    if marque.lower() in entry[1].lower() or entry[1].lower() in marque.lower():
                        wmi = entry[0]
                        break

            if wmi and wmi not in seen:
                seen.add(wmi)
                rows.append({
                    'wmi': wmi,
                    'marque': marque,
                    'modele': modele,
                    'anneeMin': annee_min,
                    'anneeMax': annee_max,
                    'motorisation': motorisation,
                    'photoId': '',
                    'notes': notes,
                    'statut': 'OK'
                })
                print(f"  ✓ BKA: {wmi} — {marque} — {modele} [{annee_min}-{annee_max}]")

    return rows

# ─── CONSTRUCTION BASE WMI ─────────────────────────────────────────────────────
def build_wmi_rows():
    """Construire les lignes depuis la base WMI statique."""
    rows = []
    for entry in WMI_DB:
        wmi, marque, pays, modele, annees = entry
        parts = annees.split('-')
        annee_min = parts[0] if len(parts) >= 1 else ''
        annee_max = parts[1] if len(parts) >= 2 else ''
        rows.append({
            'wmi': wmi,
            'marque': marque,
            'modele': modele,
            'anneeMin': annee_min,
            'anneeMax': annee_max,
            'motorisation': '',
            'photoId': '',
            'notes': f'WMI public | {pays}',
            'statut': 'OK'
        })
    return rows

# ─── ENVOI VERS GAS ────────────────────────────────────────────────────────────
def send_batch(rows, mode='append'):
    """Envoyer un batch de lignes vers le GAS."""
    payload = json.dumps({
        'action': 'importBkaData',
        'rows': rows,
        'mode': mode
    }).encode('utf-8')

    req = urllib.request.Request(
        GAS_URL,
        data=payload,
        headers={'Content-Type': 'application/json'},
        method='POST'
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read().decode('utf-8')
            return json.loads(body)
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8')
        print(f"  HTTP Error {e.code}: {body[:200]}")
        return None
    except Exception as ex:
        print(f"  Erreur réseau: {ex}")
        return None

def upload_all(rows):
    """Envoyer toutes les lignes par batches."""
    total_written = 0
    for i in range(0, len(rows), BATCH):
        batch = rows[i:i+BATCH]
        mode = MODE if i == 0 else 'append'
        print(f"  → Envoi batch {i//BATCH + 1} ({len(batch)} lignes, mode={mode})...")
        result = send_batch(batch, mode)
        if result:
            if result.get('ok'):
                total_written += result.get('written', 0)
                print(f"     ✓ {result.get('written', 0)} écrites, {result.get('skipped', 0)} doublons, total sheet={result.get('total', '?')}")
            else:
                print(f"     ✗ Erreur GAS: {result.get('error', '?')}")
        else:
            print(f"     ✗ Pas de réponse")
    return total_written

# ─── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    print("=" * 60)
    print("BKA Import — VIN Expert ATTT")
    print(f"Mode: {MODE}")
    print("=" * 60)

    # 1. Parser les fichiers BKA locaux
    print("\n[1/3] Parsing des fichiers HTML BKA...")
    bka_rows = parse_bka_files()
    print(f"  → {len(bka_rows)} entrées extraites des fichiers BKA")

    # 2. Base WMI étendue
    print("\n[2/3] Construction base WMI étendue...")
    wmi_rows = build_wmi_rows()
    print(f"  → {len(wmi_rows)} entrées WMI")

    # Fusionner (BKA en premier pour priorité, puis WMI)
    all_rows = bka_rows + wmi_rows

    # Déduplication locale par WMI (conserver la première occurrence)
    seen = set()
    deduped = []
    for r in all_rows:
        wmi = r['wmi'].upper().strip()
        if wmi and wmi not in seen:
            seen.add(wmi)
            deduped.append(r)

    print(f"  → {len(deduped)} entrées uniques après dédupication")

    # 3. Upload vers GAS
    print(f"\n[3/3] Upload vers GAS ({len(deduped)} lignes en {(len(deduped)//BATCH)+1} batches)...")
    total = upload_all(deduped)
    print(f"\n✅ Import terminé — {total} nouvelles entrées écrites dans VIN_REF_BKA")
    print(f"   GAS URL: {GAS_URL}")

if __name__ == '__main__':
    main()
