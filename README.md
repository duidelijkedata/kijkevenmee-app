# Kijk even mee – V1 (Supabase + Vercel)

Dit project is een V1 webapp:
- Ouder kan hulp vragen + scherm delen (alleen meekijken, geen overname)
- Kind kan met code meekijken
- Kind heeft “Mijn omgeving” met inbox (screenshots), historie en instellingen
- Screenshots worden opgeslagen in Supabase Storage

## 0) Vereisten
- Node 18+ of 20+
- Supabase project
- Vercel account
- (optioneel) GitHub repo

---

## 1) Supabase setup (1x)

### 1.1 Project aanmaken
Maak een nieuw Supabase project.

### 1.2 Auth instellingen (magic link)
- Ga naar Authentication → Providers → Email
- Zet **Email** aan (magic link / OTP)
- Zet redirect URLs:
  - `http://localhost:3000/**`
  - `https://<jouw-vercel-domein>/**`

### 1.3 SQL schema
- Ga naar SQL editor
- Plak en run: `supabase.sql` (in de root van dit project)

### 1.4 Storage bucket
- Ga naar Storage → Create bucket
- Naam: `snapshots`
- Zet bucket op **Private**

### 1.5 Realtime
Broadcast is standaard beschikbaar. Zie Supabase docs voor Broadcast en Subscribe.
Als je geen messages ontvangt, check Realtime settings / Broadcast authorization.

---

## 2) Lokaal draaien

### 2.1 Env vars
Maak `.env.local` aan (je kunt `.env.example` kopiëren):

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

### 2.2 Install + run
```
npm install
npm run dev
```

Open: http://localhost:3000

---

## 3) Vercel deploy

### 3.1 GitHub (aanrader)
1. Maak een GitHub repo
2. Push deze code

### 3.2 Vercel import
- Vercel → Add New → Project → Import GitHub repo
- Zet env vars in Vercel:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`

Deploy.

---

## 4) Gebruik

### Ouder
- Ga naar `/ouder`
- Start hulp → krijg code + link
- Ga naar `/join/<code>` en klik “Deel mijn scherm”

### Kind
- Ga naar `/kind` en log in
- “Verbind met code” (pagina: `/kind/verbinden`)
- Kijk mee

> Let op: Screenshots uploaden werkt pas als de sessie een `helper_id` heeft.
In V1 koppel je dit door eerst als kind te verbinden en later de upload te doen.
(Volgende iteratie: “claim session” endpoint zodat helper_id automatisch gezet wordt.)

