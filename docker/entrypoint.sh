#!/bin/sh
# Jeden kontener: Mosquitto + backend/panel magazyniera (+ opcjonalnie symulator czujnikow).
# Gdy dowolny proces padnie, kontener konczy prace i Docker restartuje calosc.
mkdir -p /app/data/mosquitto

# Broker wymaga logowania. Plik hasel jest generowany przy kazdym starcie z MQTT_USER / MQTT_PASSWORD.
if [ -z "$MQTT_USER" ] || [ -z "$MQTT_PASSWORD" ]; then
  echo "Brak MQTT_USER lub MQTT_PASSWORD - ustaw je w pliku .env (patrz .env.example)"; exit 1
fi
mosquitto_passwd -b -c /app/data/mosquitto/passwd "$MQTT_USER" "$MQTT_PASSWORD" || exit 1

mosquitto -c /app/docker/mosquitto.conf &
MOSQ=$!

# czekamy az broker zacznie nasluchiwac
i=0
until nc -z 127.0.0.1 1883 2>/dev/null; do
  i=$((i+1)); [ "$i" -gt 50 ] && { echo "Mosquitto nie wystartowal"; exit 1; }
  sleep 0.2
done

export MQTT_HOST=127.0.0.1 MQTT_PORT=1883
node src/server.js &
APP=$!

PIDS="$MOSQ $APP"
if [ "$SIMULATOR" = "1" ]; then
  node simulator/simulator.js &
  PIDS="$PIDS $!"
fi

stop() { kill $PIDS 2>/dev/null; exit 0; }
trap stop TERM INT

while :; do
  for p in $PIDS; do
    kill -0 "$p" 2>/dev/null || { echo "Proces $p zakonczyl sie - zatrzymuje kontener"; kill $PIDS 2>/dev/null; exit 1; }
  done
  sleep 2
done
