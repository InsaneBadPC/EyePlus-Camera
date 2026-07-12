window.EyePlusDiscovery = (function() {

const WS_DISCOVERY_URL = "http://239.255.255.250:3702";
const ONVIF_PROBE_TIMEOUT = 3000;

const WS_DISCOVERYEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope"
            xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"
            xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"
            xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
  <e:Header>
    <w:MessageID>uuid:</w:MessageID>
    <w:To e:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>
    <w:Action e:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>
  </e:Header>
  <e:Body>
    <d:Probe>
      <d:Types>dn:NetworkVideoTransmitter</d:Types>
    </d:Probe>
  </e:Body>
</e:Envelope>`;

async function discoverCameras() {
  const cameras = [];

  try {
    const xmlCameras = await wsDiscoveryProbe();
    cameras.push(...xmlCameras);
  } catch (e) {
    console.log("WS-Discovery failed:", e.message);
  }

  const commonIPs = [
    "172.20.94.172", "192.168.1.1", "192.168.0.1", "192.168.1.100",
    "192.168.0.100", "10.0.0.1", "10.0.0.100", "192.168.1.10",
    "192.168.0.10", "192.168.1.64", "192.168.0.64",
  ];

  const localIP = getLocalIP();
  if (localIP) {
    const base = localIP.substring(0, localIP.lastIndexOf('.'));
    for (let i = 1; i <= 20; i++) {
      commonIPs.push(`${base}.${i}`);
    }
  }

  const unique = new Set(cameras.map(c => c.ip));
  const toCheck = commonIPs.filter(ip => !unique.has(ip));

  const results = await Promise.allSettled(
    toCheck.map(ip => probeONVIF(ip, 80).then(cam => {
      if (cam && !unique.has(cam.ip)) {
        unique.add(cam.ip);
        cameras.push(cam);
      }
    }))
  );

  return cameras;
}

async function wsDiscoveryProbe() {
  return new Promise((resolve, reject) => {
    const cameras = [];
    const uuid = crypto.randomUUID();

    const udp = new WebSocket(`ws://${WS_DISCOVERY_URL.replace('http://', '')}`);
    const msg = WS_DISCOVERYEnvelope.replace('<w:MessageID>uuid:</w:MessageID>', `<w:MessageID>uuid:${uuid}</w:MessageID>`);

    const timeout = setTimeout(() => {
      try { udp.close(); } catch(e) {}
      resolve(cameras);
    }, ONVIF_PROBE_TIMEOUT);

    udp.onopen = () => {
      try {
        udp.send(msg);
      } catch(e) {
        clearTimeout(timeout);
        reject(e);
      }
    };

    udp.onmessage = (event) => {
      try {
        const xml = event.data;
        const ipMatch = xml.match(/<[^>]*Address[^>]*>([^<]*<\/[^>]*Address>|)/);
        const xaddrs = xml.match(/<[^>]*XAddrs[^>]*>([^<]*)/);
        if (xaddrs && xaddrs[1]) {
          const url = xaddrs[1].trim();
          const match = url.match(/https?:\/\/([\d.]+)/);
          if (match) {
            cameras.push({
              ip: match[1],
              url: url,
              name: extractName(xml),
              source: 'ws-discovery'
            });
          }
        }
      } catch(e) {}
    };

    udp.onerror = () => {
      clearTimeout(timeout);
      resolve(cameras);
    };
  });
}

async function probeONVIF(ip, port) {
  const soap = `<?xml version="1.0" encoding="UTF-8"?>
<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope"
            xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"
            xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery">
  <e:Header>
    <w:MessageID>uuid:${crypto.randomUUID()}</w:MessageID>
    <w:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>
    <w:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>
  </e:Header>
  <e:Body>
    <d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe>
  </e:Body>
</e:Envelope>`;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2000);

    const r = await fetch(`http://${ip}:${port}/onvif/device_service`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/soap+xml' },
      body: soap,
      signal: ctrl.signal
    });
    clearTimeout(timer);

    if (r.ok) {
      const text = await r.text();
      return {
        ip: ip,
        port: port,
        name: extractName(text) || `Kamera ${ip}`,
        source: 'onvif-probe'
      };
    }
  } catch(e) {}

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch(`http://${ip}:${port}/`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (r.ok || r.status === 401) {
      return { ip, port, name: `Zarizeni ${ip}`, source: 'http-probe' };
    }
  } catch(e) {}

  return null;
}

function extractName(xml) {
  const nameMatch = xml.match(/<[^>]*FriendlyName[^>]*>([^<]+)/i)
    || xml.match(/<[^>]*DeviceName[^>]*>([^<]+)/i)
    || xml.match(/<[^>]*Model[^>]*>([^<]+)/i);
  return nameMatch ? nameMatch[1].trim() : null;
}

function getLocalIP() {
  try {
    const rtc = new RTCPeerConnection({ iceServers: [] });
    rtc.createDataChannel('');
    rtc.createOffer().then(offer => rtc.setLocalDescription(offer));
    // This is async, but for our purposes we'll just return null
    // and rely on the common IP list
    rtc.close();
  } catch(e) {}
  return null;
}

async function quickScan(subnet) {
  const cameras = [];
  const promises = [];

  for (let i = 1; i <= 254; i++) {
    const ip = `${subnet}.${i}`;
    promises.push(
      probeONVIF(ip, 80).then(cam => {
        if (cam) cameras.push(cam);
      }).catch(() => {})
    );

    if (promises.length >= 50) {
      await Promise.allSettled(promises);
      promises.length = 0;
    }
  }

  await Promise.allSettled(promises);
  return cameras;
}

return {
  discoverCameras,
  quickScan,
  probeONVIF
};

})();
