# Módulos do Curso Preparatório CEH v13

## Módulo 1 – Introdução ao Ethical Hacking
- Explicar os fundamentos da segurança da informação e do hacking ético
- Comparar metodologias e frameworks de hacking (metodologia CEH, Cyber Kill Chain, MITRE ATT&CK, Diamond Model)

**Principais tópicos:** Tríade CIA, classes de ataque, hackers e suas motivações, fases do hacking, controles de segurança da informação, leis e normas (PCI DSS, ISO/IEC 27001, HIPAA, SOX, GDPR, DMCA).

**Domínio do exame:** Information Security and Ethical Hacking Overview (6%)
**Pré-requisitos:** nenhum

## Módulo 2 – Footprinting e Reconhecimento
- Aplicar técnicas e ferramentas de footprinting na fase de pré-ataque
- Recomendar contramedidas contra a coleta de informações

**Principais tópicos:** Footprinting passivo e ativo, Google Dorks e Google Hacking Database, Shodan, OSINT em redes sociais, footprinting de sites e e-mail, Whois, DNS (transferência de zona), traceroute, theHarvester, Recon-ng, Maltego.

**Domínio do exame:** Reconnaissance Techniques (17%)
**Pré-requisitos:** M01

## Módulo 3 – Varredura de Redes (Scanning Networks)
- Executar descoberta de hosts, portas, serviços e sistemas operacionais
- Aplicar técnicas de varredura além de IDS e firewalls

**Principais tópicos:** Flags TCP e three-way handshake, Nmap (-sS, -sT, -sU, -sA, -sN/-sF/-sX, -sV, -O, -sn, -Pn), hping3, idle/zombie scan, banner grabbing, fingerprinting de SO (TTL/janela TCP), fragmentação, decoys, spoofing e contramedidas.

**Domínio do exame:** Reconnaissance Techniques (17%)
**Pré-requisitos:** M02

## Módulo 4 – Enumeração
- Enumerar usuários, compartilhamentos e serviços em protocolos de rede
- Aplicar contramedidas contra enumeração

**Principais tópicos:** NetBIOS (nbtstat, net view), SNMP (community strings, MIB, snmpwalk), LDAP, NTP, NFS (showmount), SMTP (VRFY, EXPN, RCPT TO), DNS (AXFR), IPsec, VoIP/SIP, RPC, SMB (enum4linux), IPv6 e BGP.

**Domínio do exame:** Reconnaissance Techniques (17%)
**Pré-requisitos:** M03

## Módulo 5 – Análise de Vulnerabilidades
- Identificar brechas de segurança em redes, infraestrutura e sistemas finais
- Interpretar relatórios e pontuações de vulnerabilidade

**Principais tópicos:** Ciclo de vida da gestão de vulnerabilidades, classificação de vulnerabilidades, CVSS, CVE, CWE, NVD, avaliações ativas/passivas, credenciadas/não credenciadas, scanners (Nessus, OpenVAS, Nikto, Qualys) e relatórios.

**Domínio do exame:** System Hacking Phases and Attack Techniques (15%)
**Pré-requisitos:** M04

## Módulo 6 – Invasão de Sistemas (System Hacking)
- Aplicar a metodologia de system hacking para obter e manter acesso
- Explicar técnicas de ocultação e de encobrimento de rastros

**Principais tópicos:** Quebra de senhas (dicionário, força bruta, rainbow tables, pass-the-hash), John the Ripper, Hashcat, Hydra, Mimikatz, escalonamento de privilégios, persistência, rootkits, esteganografia, NTFS ADS, limpeza de logs.

**Domínio do exame:** System Hacking Phases and Attack Techniques (15%)
**Pré-requisitos:** M05

## Módulo 7 – Ameaças de Malware
- Diferenciar tipos de malware, APTs e malware fileless
- Aplicar procedimentos de análise de malware e contramedidas

**Principais tópicos:** Trojans, vírus, worms, ransomware, droppers, crypters, APT, malware fileless (PowerShell, WMI, LOLBins), análise estática e dinâmica, sandbox, IoCs, antimalware.

**Domínio do exame:** System Hacking Phases and Attack Techniques (15%)
**Pré-requisitos:** M06

## Módulo 8 – Sniffing
- Explicar técnicas de captura de pacotes e ataques na camada 2
- Detectar e mitigar ataques de sniffing

**Principais tópicos:** Sniffing passivo e ativo, MAC flooding, ataques DHCP (starvation, servidor falso), ARP poisoning, MAC spoofing, envenenamento de DNS, Wireshark e filtros, port security, DHCP snooping, Dynamic ARP Inspection.

**Domínio do exame:** Network and Perimeter Hacking (24%)
**Pré-requisitos:** M03

## Módulo 9 – Engenharia Social
- Identificar técnicas de engenharia social e ameaças internas
- Recomendar contramedidas para vulnerabilidades humanas

**Principais tópicos:** Phishing, spear phishing, whaling, vishing, smishing, pretexting, tailgating/piggybacking, quid pro quo, ameaças internas, personificação em redes sociais, roubo de identidade, deepfakes, SET (Social-Engineer Toolkit).

**Domínio do exame:** Network and Perimeter Hacking (24%)
**Pré-requisitos:** M02

## Módulo 10 – Negação de Serviço (DoS/DDoS)
- Explicar técnicas de ataque DoS/DDoS e botnets
- Recomendar contramedidas e ferramentas de proteção

**Principais tópicos:** Ataques volumétricos, de protocolo e de camada de aplicação, SYN flood, amplificação (DNS, NTP, memcached), Slowloris, botnets, SYN cookies, rate limiting, scrubbing centers.

**Domínio do exame:** Network and Perimeter Hacking (24%)
**Pré-requisitos:** M03

## Módulo 11 – Sequestro de Sessão (Session Hijacking)
- Diferenciar sequestro de sessão em nível de aplicação e de rede
- Aplicar contramedidas contra sequestro de sessão

**Principais tópicos:** Previsão de números de sequência TCP, session fixation, roubo de cookies via XSS, CSRF, man-in-the-browser, flags HttpOnly/Secure/SameSite, Burp Suite, bettercap, HTTPS/HSTS.

**Domínio do exame:** Network and Perimeter Hacking (24%)
**Pré-requisitos:** M08

## Módulo 12 – Evasão de IDS, Firewalls e Honeypots
- Explicar o funcionamento de IDS/IPS, firewalls e honeypots
- Aplicar e detectar técnicas de evasão

**Principais tópicos:** Detecção por assinatura e anomalia, falsos positivos/negativos, regras Snort, tipos de firewall, fragmentação, ofuscação, tunelamento, evasão de NAC e EDR, detecção de honeypots.

**Domínio do exame:** Network and Perimeter Hacking (24%)
**Pré-requisitos:** M03, M08

## Módulo 13 – Invasão de Servidores Web
- Aplicar a metodologia de ataque a servidores web
- Recomendar contramedidas e gestão de patches

**Principais tópicos:** Directory traversal, configurações incorretas, HTTP response splitting, web cache poisoning, ataques a SSH/FTP, banner grabbing de servidores web, Nikto, hardening, gestão de patches.

**Domínio do exame:** Web Application Hacking (14%)
**Pré-requisitos:** M03, M05

## Módulo 14 – Invasão de Aplicações Web
- Aplicar a metodologia de hacking de aplicações web
- Explorar falhas de autenticação, autorização, sessão, injeção e lógica

**Principais tópicos:** OWASP Top 10, XSS, CSRF, SSRF, XXE, IDOR, command injection, file inclusion, APIs e webhooks, web shells, Burp Suite, OWASP ZAP.

**Domínio do exame:** Web Application Hacking (14%)
**Pré-requisitos:** M13

## Módulo 15 – Injeção de SQL
- Explicar os tipos e a metodologia de injeção de SQL
- Aplicar técnicas de evasão e contramedidas

**Principais tópicos:** SQLi in-band (baseada em erro, UNION), cega (booleana e baseada em tempo), out-of-band, sqlmap, evasão de WAF, consultas parametrizadas, validação de entrada, privilégio mínimo no banco.

**Domínio do exame:** Web Application Hacking (14%)
**Pré-requisitos:** M14

## Módulo 16 – Invasão de Redes Sem Fio
- Explicar criptografia e ameaças em redes sem fio
- Aplicar ferramentas e contramedidas de segurança wireless

**Principais tópicos:** WEP, WPA, WPA2, WPA3 (SAE), handshake de 4 vias, aircrack-ng suite, evil twin, KRACK, rogue AP, deautenticação, ataques Bluetooth (bluejacking, bluesnarfing, bluebugging), WIPS.

**Domínio do exame:** Wireless Network Hacking (5%)
**Pré-requisitos:** M08

## Módulo 17 – Invasão de Plataformas Móveis
- Explicar vetores de ataque em Android e iOS
- Aplicar gestão de dispositivos móveis e diretrizes de segurança

**Principais tópicos:** OWASP Mobile Top 10, rooting e jailbreaking, sideloading, APKs maliciosos, SMS phishing, adb, MDM, containerização, sandboxing de apps.

**Domínio do exame:** Mobile Platform, IoT, and OT Hacking (10%)
**Pré-requisitos:** M07, M14

## Módulo 18 – Invasão de IoT e OT
- Explicar arquiteturas e ataques em IoT e OT
- Aplicar metodologias de hacking e contramedidas para IoT/OT

**Principais tópicos:** Protocolos IoT (MQTT, CoAP, Zigbee), Shodan, ataques de firmware, rolling code, modelo Purdue, SCADA, PLC, Modbus, ataques a ICS, segmentação IT/OT.

**Domínio do exame:** Mobile Platform, IoT, and OT Hacking (10%)
**Pré-requisitos:** M03, M04

## Módulo 19 – Computação em Nuvem
- Explicar conceitos de nuvem, containers e computação serverless
- Identificar ameaças, ataques e controles de segurança em nuvem

**Principais tópicos:** IaaS, PaaS, SaaS, modelo de responsabilidade compartilhada, Docker, Kubernetes, serverless, buckets S3 mal configurados, metadata service (IMDS), escape de container, CASB, CSPM.

**Domínio do exame:** Cloud Computing (5%)
**Pré-requisitos:** M14

## Módulo 20 – Criptografia
- Explicar algoritmos de criptografia, PKI e criptografia de e-mail e disco
- Identificar ataques criptográficos e ferramentas de criptoanálise

**Principais tópicos:** Criptografia simétrica (AES, 3DES) e assimétrica (RSA, ECC, Diffie-Hellman), hashing (SHA-2, MD5), assinaturas digitais, PKI e certificados, PGP/S/MIME, BitLocker/VeraCrypt, ataques de aniversário, downgrade e side-channel.

**Domínio do exame:** Cryptography (5%)
**Pré-requisitos:** M01
