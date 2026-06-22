# springflow

## Code

Vibe-coded Materialfluss-Simulationen mit Weichen und Staustrecken mit Min-/Max-Sensoren.
Läuft auf https://8gentli.github.io/springflow (Stand Juni 2026). Privates Repository von LISI2.

Varianten: 
- Weichen: 3-fach, 4-fach
- Abnehmer: Einzeln oder Batch
- Weichenlogik: Füllen oder Round-Robin

Zusatz:
- Simulation Transportversuch für YDS-200 mit 3-fach- und 4-fach-Weiche.

**Achtung!** Push/Pull nie vergessen! Repo wird an verschiedenen Orten bearbeitet.

## Hintergrund

### Taktraten

Diese werden folgendermassen berechnet:  
| Bezeichnung | Asic CSS, 2x 4-fach-Zuführung | Asic IS, 3x 2-fach-Zuführung | Bemerkung |  
| --- | --- | --- | --- |  
| Weiche | **4-fach** | **3-fach** | Spuren pro Winder |  
| Spuren total | 8 | 6 | (Spuren pro Winder * 2 Winder) |  
| ppm pro Spur | 80 | 80 | Taktrate Asic insgesamt |  
| ppm pro Spur | 10.00 | 13.33 | (ppm pro Spur / Spuren total) |  
| **Takt pro Spur (s)**| **6.00** | **4.50** | (60 s / ppm pro Spur) **Abnahme-Zyklus Asic** |  

