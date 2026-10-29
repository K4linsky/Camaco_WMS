# StorageMaster – panel magazyniera

Aplikacja webowa (po polsku, responsywna – tablet/telefon) odbierająca dane z czujników
projektu StorageWMS przez MQTT i pokazująca na żywo: stan miejsc, status urządzenia
(online/offline), alerty oraz historię zdarzeń. **Zero zależności npm** – wystarczy Node.js >= 18.

## Co wynika z projektu StorageWMS (`D:\StorageWMS\StorageWMS.ino`)

- Urządzenie: ESP32 (ESP-WROOM-32), `DEVICE_ID = storagewms-1`.
- Czujniki: **3x E18-D80NK** (cyfrowe, podczerwień, zasięg 3–80 cm), GPIO 27/26/19.
  Wyjście OUT = LOW, gdy obiekt jest w zasięgu. To czujniki **obecności** (0/1) – brak
  temperatury, wilgotności czy wagi.
- Protokół: **MQTT** (PubSubClient), port 1883, opcjonalnie user/hasło (`secrets.h`).
- Tematy (wszystkie *retained*):
  - `storagewms/1/status` – `online` / `offline` (Last Will przy utracie połączenia),
  - `storagewms/1/sensor/<1..4>/state` – `detected` (obiekt wykryty) / `clear`.
- Firmware publikuje stan przy każdej zmianie (debounce 50 ms) oraz wszystkie stany po (re)connect.

## Założenia (czego w projekcie brakuje)

1. Każdy czujnik pilnuje jednego „miejsca” (półka/paleta/stanowisko): `detected` = **PEŁNY** (zielony), `clear` = **PUSTY** (czerwony).
   Nazwy domyślnie „Miejsce 1–3”; zmiana przez `SENSOR_NAMES="Rampa A,Rampa B,Półka 1"`.
2. „Progi” w przypadku czujników binarnych: alert **„pełne zbyt długo”** (ciągłe `detected` dłużej niż
   `ALERT_OCCUPIED_SEC`, domyślnie 3600 s = 60 min, poziom ostrzeżenie) oraz alert krytyczny **„urządzenie offline”**.
   Wartości są do potwierdzenia z użytkownikiem.
3. Czujnik jest „online”, gdy urządzenie ma status `online`. Czujniki nie wysyłają heartbeatu
   (publikują tylko przy zmianie), więc offline wykrywamy przez Last Will (`offline`) – stąd poprawny
   status wymaga, by broker dostarczał LWT.
4. Wbudowany broker MQTT jest **bez uwierzytelniania** (sieć lokalna magazynu); akceptuje dowolny user/hasło.
   Dla środowiska produkcyjnego użyj zewnętrznego brokera (np. Mosquitto) przez `MQTT_HOST`.
5. Historia: 500 ostatnich zdarzeń w pamięci, zapisywana też do `data/history.jsonl` (wczytywana po restarcie).
   Alerty są wyliczane na bieżąco (nie są potwierdzane ręcznie).
6. Obsługiwane są tylko tematy `storagewms/<id urządzenia>/...`; nowe urządzenia/czujniki pojawiają się automatycznie.

## Uruchomienie

```
cd D:\StorageWMS\StorageMaster
npm run demo        # serwer + symulator (próg alertu 60 s), potem otwórz http://localhost:3000
```

Albo osobno (dwa terminale):

```
npm start           # panel: http://localhost:3000 + wbudowany broker MQTT na :1883
npm run simulator   # symulator ESP32 (bez sprzętu)
```

Z prawdziwym ESP32: w `secrets.h` ustaw `MQTT_HOST` na adres IP komputera z `npm start`
(port 1883 musi być dostępny w zaporze). Symulatora wtedy nie uruchamiaj. Z telefonu/tabletu
wejdź na `http://<IP komputera>:3000`.

Testy: `npm test`.

### Zmienne środowiskowe

| Zmienna | Domyślnie | Opis |
|---|---|---|
| `PORT` / `HOST` | 3000 / 0.0.0.0 | serwer HTTP |
| `MQTT_PORT` | 1883 | port wbudowanego brokera lub zewnętrznego |
| `MQTT_HOST` | – | jeśli ustawione: łączy się z zewnętrznym brokerem, wbudowany nie startuje (gdy port 1883 jest zajęty, np. przez Mosquitto) |
| `MQTT_USER`, `MQTT_PASSWORD` | – | dane do zewnętrznego brokera |
| `ALERT_OCCUPIED_SEC` | 3600 | próg alertu „pełne zbyt długo” |
| `SENSOR_NAMES` | Miejsce 1..3 | nazwy czujników po przecinku |
| `HISTORY_FILE` | data/history.jsonl | plik historii |
| `SIM_SPEED` | 1 | (symulator) przyspieszenie czasu, np. 5 |
| `SIM_DROPOUTS` | 1 | (symulator) 0 = bez symulowanych zaników łączności |
| `MQTT_HOST`, `MQTT_PORT` | 127.0.0.1 / 1883 | (symulator) adres brokera |

## Struktura

```
src/server.js        HTTP + SSE + start brokera i klienta MQTT
src/broker.js        wbudowany minimalny broker MQTT 3.1.1 (retained, LWT)
src/mqtt-packet.js   kodowanie/dekodowanie pakietów MQTT
src/mqtt-client.js   minimalny klient MQTT z reconnectem
public/history.*     osobna strona logów (otwierana z belki)
src/store.js         stan czujników, alerty, historia
src/config.js        konfiguracja z env
public/              frontend (index.html, style.css, app.js) – bez frameworków
simulator/           simulator.js (ESP32 „storagewms-1”), demo.js (serwer + symulator)
test/                testy jednostkowe i integracyjne (node:test)
```

## API

- `GET /api/stream` – Server-Sent Events, zdarzenie `state` z pełnym stanem (używa je UI).
- `GET /api/state` – bieżący stan (czujniki, urządzenia, alerty, ostatnie zdarzenia).
- `GET /api/history?limit=100&sensor=1:2&type=sensor|device|alert|alert_clear` – historia (najnowsze pierwsze).
- `GET /api/health`.

### Regały (edycja przez magazyniera)

Regał (etykieta) → półki → boxy. Box = jeden produkt + jeden czujnik (każdy czujnik tylko do jednego boxa).
Status boxa (pusty/pełny/brak danych) i godzina ostatniej aktualizacji pochodzą z czujnika (ostatni odebrany odczyt).
Konfiguracja w `data/racks.json` (`RACKS_FILE`). Czujniki z MQTT pojawiają się na liście wyboru automatycznie.

- `GET /api/racks`
- `POST /api/racks` `{label, shelves?, boxes?}` · `PUT /api/racks/:id` `{label}` · `DELETE /api/racks/:id`
- `POST /api/racks/:id/shelves` `{label?, boxes?}` · `PUT|DELETE /api/racks/:id/shelves/:sid`
- `POST /api/racks/:id/shelves/:sid/boxes` `{product?, sensor?}` · `PUT|DELETE .../boxes/:bid` (`sensor`: `"1:2"` lub `null`)

Zmiany są rozsyłane na żywo przez `/api/stream` (pole `racks`). Panel bez logowania (sieć lokalna).
