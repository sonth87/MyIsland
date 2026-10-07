# Kế hoạch triển khai: Keepsakeland & Himeji Castle (trước đây: Grand Valley)

> Hai web game 3D stylized làm bằng Three.js:
> - **Keepsakeland**: hành tinh nhỏ, nhân vật đi bộ quanh quả cầu, khám phá các điểm kỷ niệm (ảnh, câu chuyện).
> - **Grand Valley**: thung lũng sinh tự động có sông, đường ray, làng. Người chơi điều khiển thuyền, lái tàu, và xem từ nhiều góc camera (buồng lái, hành khách, toàn cảnh...).
>
> Hai dự án dùng chung một **engine nội bộ** (render stylized, input, camera, asset, audio, UI). Keepsakeland làm trước vì phạm vi nhỏ hơn và sẽ "rèn" engine.

---

## Trạng thái

| Mốc | Tình trạng | Ghi chú |
|---|---|---|
| M0: Khung dự án | ✅ Xong | pnpm monorepo, Vite, TS strict, Vitest; `pnpm dev` / `pnpm dev:himeji` |
| Spike "đi quanh quả cầu" | ✅ Xong | Hành tinh noise + zone, nhân vật đi/chạy/nhảy, click-to-move, joystick cảm ứng, camera overview ⇄ fly-in ⇄ walk |
| M1: Look stylized | 🟡 Gần xong | Toon theo địa hình cục bộ, outline mờ dần theo sương, grain, 4 mức chi tiết (Thấp → Rất cao, mịn dần). Còn thiếu: pixelate pass |
| Môi trường (mới, ngoài kế hoạch gốc) | ✅ Xong | Xem mục 13 |
| M4: Nhân vật & camera | 🟡 Phần lớn | 3 góc nhìn, camera tránh cây/nhà, hoạt ảnh thủ tục, 5 nhân vật điều khiển được, NPC đi dạo/chào hỏi. Còn thiếu: model glTF có rig, tiếng bước chân |
| M5: POI, nội dung | ⏳ Chưa làm | Đã có tương tác (nói chuyện, rung cây, ngồi ghế, chụp ảnh) làm nền cho POI |
| Âm thanh (M2) | ✅ Xong | Tổng hợp bằng Web Audio, không cần file: gió, mưa, nước, chim, dế, sấm, bước chân, màn trập, tàu, động cơ cano, nhạc koto ngẫu hứng |
| M7–M10: Grand Valley | ✅ Bản đầu | Xem mục 14 |

## 13. Hệ thống môi trường & tương tác (đã làm)

| Hạng mục | Cách làm | File |
|---|---|---|
| Ngày/đêm | Mặt trời quay trên quỹ đạo nghiêng 23°; giờ địa phương tính theo kinh độ trên quỹ đạo, nên nửa hành tinh luôn là đêm. Chế độ chạy (1–30 phút/ngày) hoặc cố định giờ; giữ `T` để tua nhanh | `env/WorldClock.ts` |
| Ánh sáng mềm qua vùng hoàng hôn | Shader dùng chung: sáng/tối toon tính *tương đối với mặt đất tại chỗ*; độ cao mặt trời cục bộ quyết định nắng tắt dần, ánh cam hoàng hôn, ánh sáng môi trường xanh đêm, ánh trăng | `env/envShader.ts` |
| Bầu trời & khí quyển | Vòm trời gradient theo giờ địa phương, quầng cam phía mặt trời lặn, đĩa mặt trời/trăng, sao lấp lánh; từ quỹ đạo: nền đổi màu, viền khí quyển, mặt trời/trăng bay quanh hành tinh | `env/Sky.ts` |
| Sương mù | Màu = màu chân trời; dày lên khi mưa/tuyết; tắt khi ở quỹ đạo | `env/Environment.ts` |
| Gió | Trường gió tiếp tuyến toàn cục (quay quanh 1 trục), cường độ + giật theo nhịp; cỏ/lúa/hoa uốn từ gốc, cây lắc thân + rung tán, bóng đổ lắc theo | `env/Weather.ts`, `envShader.ts` |
| Lá rơi | Hạt sinh từ tán cây gần người chơi, nhiều hơn khi gió mạnh; trọng lực hướng tâm, lực cản kéo theo gió, chao lượn, rơi xuống đất nằm lại / nổi trên nước, gió mạnh thổi bay lại | `env/Leaves.ts` |
| Mưa / tuyết | Hạt trong khối quanh người chơi, rơi về tâm hành tinh, xiên theo gió; mưa có gợn nước, mặt đất ướt sẫm lại; tuyết bám dần lên mặt hướng lên rồi tan; dông có chớp | `env/Precipitation.ts` |
| Mây | Số lượng theo độ phủ, bay theo gió, xám và thấp xuống khi mưa, đổ bóng xuống đất | `life/Clouds.ts` |
| Thời tiết tự động | Chuỗi trạng thái (nắng, mây, mưa rào, dông, tuyết, gió lớn) đổi sau 45–120 s; mỗi thông số có thể khoá tay | `env/Weather.ts` |
| Nhân vật | Chu kỳ bước đi thủ tục 2 khớp, xoay hông/vai, lắc tay, thở, chớp mắt, đầu quay nhìn; nhảy (trọng lực hướng tâm), động tác vẫy tay / chụp ảnh / rung cây / trò chuyện / ngồi | `player/CharacterView.ts` |
| Góc nhìn | Thứ nhất (mắt nhân vật), thứ hai (trước mặt, điều khiển kiểu xe tăng), thứ ba (sau lưng); chuyển mượt; camera tránh tán cây/nhà | `camera/WalkCamera.ts` |
| Tương tác | Nói chuyện NPC, rung cây (lá rụng), ngồi ghế ngắm cảnh, chụp ảnh, vẫy tay, đổi sang điều khiển nhân vật khác (Tab / click); đèn lồng và cửa sổ sáng khi trời tối | `game/IslandGame.ts` |
| Cài đặt | Bảng ⚙ (phím `O`): thời gian, gió + hướng gió, mây, mưa, tuyết, góc nhìn, độ chi tiết, viền mực, bóng, lá rơi, FPS; lưu `localStorage` | `ui/SettingsPanel.ts`, `settings/` |

**Đã xử lý:** viền mực lắc theo cây (pass outline dùng material normal có gió); âm thanh; nhân vật bằng capsule thay hộp; địa hình dựng trong Web Worker (đổi độ chi tiết: khựng tối đa ~40 ms thay vì chặn cả lần dựng). **Còn:** chưa thử trên điện thoại thật.

## 14. Grand Valley (đã làm)

Engine dùng chung giờ chứa toàn bộ hệ môi trường (`packages/engine/src/env`: shader, đồng hồ, thời tiết, bầu trời, mưa/tuyết, lá) và âm thanh (`audio/SoundScape.ts`); thế giới phẳng bật bằng `setEnvWorld('flat')`.

| Hạng mục | Cách làm | File |
|---|---|---|
| Sinh thung lũng theo seed | Địa hình fbm + núi viền, sông uốn lượn khoét lòng, đồi lâu đài, đường ray vòng kín được san nền / xẻ đồi, cầu ở chỗ vượt sông hoặc thung lũng, chọn vị trí ga, làng, ruộng, cầu gỗ. ~60 ms. Có test cho 5 seed | `world/ValleyGen.ts` |
| Kiến trúc Nhật | Nhà machiya (1–2 tầng), chùa tháp 5 tầng, đền + torii, đèn lồng đá, nhà ga, cầu taiko-bashi đỏ, lâu đài Himeji (chân đá, tháp chính 5 tầng, 2 tháp phụ, chidori-hafu, shachihoko); cửa giấy và đèn sáng ban đêm | `world/japanese.ts` |
| Đường ray & cầu | Ray, tà vẹt, ballast; cầu giàn thép đỏ có thanh chéo, trụ đá xuống tận lòng sông | `world/railMesh.ts` |
| Thực vật | Thông, cây lá rộng, phong đỏ, anh đào (rừng quanh lâu đài + ven sông), bụi, đá, cỏ, hoa, lúa; tất cả lay theo gió; cánh hoa anh đào bay | `world/scatter.ts` |
| Tàu hoả | Đầu máy hơi nước (cabin hở), toa than, 4 toa khách; bám ray bằng 2 điểm bogie, bánh quay, khói theo nhịp xình xịch; tự chạy và dừng ga 8 s rồi kéo còi; chế độ tự lái có ga, phanh, dốc | `train/Train.ts` |
| Cano | Ga, bánh lái (chỉ bẻ được khi đang chạy), dòng chảy, va bờ nảy lại, nhấp nhô, vệt nước; tự chạy dọc sông khi không ai lái | `boat/Boat.ts` |
| Chim | 3 đàn boids bay lượn (đập cánh / lượn), chim sẻ chuyền cây theo cung parabol, giật mình bay xa khi tàu hoặc cano tới gần | `life/Birds.ts` |
| Góc nhìn (phím 1–8) | Toàn cảnh, bám tàu, buồng lái, cửa sổ hành khách (tự chọn phía thoáng), các cây cầu (←/→), bám cano, ghế lái cano, lượn quanh lâu đài | `cameras/CameraDirector.ts` |
| Đời sống | Dân làng đứng ở ga, phố, lâu đài, cầu gỗ; bong bóng thoại Việt–Nhật theo thời tiết, giờ, tàu đến | `life/People.ts` |
| UI | Nút "Cài đặt" giữa đáy: góc nhìn, giờ, thời tiết nhanh, gió, tốc độ tàu, kéo còi, âm thanh, seed bản đồ, đồ hoạ; đồng hồ tốc độ khi lái; khung buồng lái / cửa sổ | `ui/Ui.ts` |

### Vòng cải tiến 3 (theo góp ý)
| Hạng mục | Thay đổi | File |
|---|---|---|
| Cây | Bộ sinh cây thủ tục dùng chung: anh đào (thân xoắn, cành xoè, cụm hoa nhiều sắc hồng), lá rộng, phong, thông, tre; 3 dáng mỗi loài; kích thước / độ nghiêng / tỉ lệ ngẫu nhiên | `engine/props/trees.ts` |
| Rừng anh đào | Vành rừng quanh đồi lâu đài + công viên hanami bên kia cầu gỗ, có lối đá, đèn lồng; nền rải cánh hoa | `himeji-castle/world/scatter.ts`, `ValleyGen.ts` |
| Lâu đài Himeji | Làm lại: chân đá ishigaki cong, tháp chính 5 tầng + 3 tháp phụ, mái Nhật cong vểnh góc, chidori-hafu, cửa sổ, hành lang nối, tường thành và cổng | `himeji-castle/world/himeji.ts`, `roofs.ts` |
| Nhà | Trà thất (sàn gỗ, lan can, cửa shoji sáng đêm), nhà minka mái tranh, torii kasagi cong, chùa tháp và đền mái cong | `himeji-castle/world/japanese.ts` |
| Nhân vật | Khớp lò xo (có quán tính, rung nhẹ, lắng lại), gót/mũi chân, khuỷu tay trễ nhịp, nghiêng người khi rẽ/tăng tốc, đầu giữ thăng bằng, cử chỉ khi đứng yên (vươn vai, gãi đầu, xem giờ, dồn trọng tâm), tóc đuôi ngựa nảy, kimono; dùng chung 2 game | `engine/character/CharacterView.ts` |
| Dân làng | Đi dạo thật trên phố, sân ga, công viên, trước lâu đài; dừng, nhìn quanh, khoa tay khi nói | `himeji-castle/life/People.ts` |
| Cano | Thân tàu lofted có mũi tròn, đáy chữ V, ghế, bảng lái + vô lăng, kính chắn gió, 2 máy; người lái ngồi cầm lái | `himeji-castle/boat/Boat.ts` |
| Nước | Màu theo độ sâu, bọt trắng mép bờ, mảng sáng trôi | `engine/env/envShader.ts` |
| Sinh vật | Bướm (đậu, bay chập chờn), chuồn chuồn (lao rồi đứng yên trên nước), chim én lượn vòng; lá súng, hoa sen, cá nhảy kèm vòng gợn | `engine/life/Critters.ts`, `Pond.ts` |
| Hiệu năng | LOD theo khoảng cách (cây gần chi tiết, xa đơn giản; cỏ/hoa ẩn dần), tầm nhìn (Gần/Vừa/Xa/Rất xa) + sương mù che chỗ cắt; độ chi tiết 4 mức cho Grand Valley | `engine/lod/LodInstances.ts`, `himeji-castle/detail.ts` |
| Camera tự do (Grand Valley) | Toàn cảnh kiểu bản đồ: kéo trái dời view (điểm dưới con trỏ bám theo chuột), chuột phải / Shift+kéo / Q,E xoay, double-click bay tới, nút "Điểm đến"; chế độ **Bay tự do** (phím 9) | `himeji-castle/cameras/CameraDirector.ts`, `engine/input/Input.ts` (`altDrag`) |
| Chất lượng mô hình | `setQuality(0..3)` theo độ chi tiết; mái Nhật (độ cong, sọc ngói, sống mái, ngói đầu mái), lâu đài (đai, khung + song cửa, chân đá chia nhỏ), machiya (mái cong, rèm noren, chậu cây, thùng nước), tàu (nồi hơi tròn, vòm, bánh có nan, thanh truyền chạy theo bánh, mái cong, bogie, ban công), cano (thân lofted, đường mớn nước), người (độ tròn) | `engine/render/quality.ts`, `himeji-castle/world/roofs.ts`, `himeji.ts`, `train/trainModel.ts`, `boat/boatModel.ts` |
| Mặt nước | Sóng nhẹ, pháp tuyến gợn, phản chiếu màu trời (fresnel), vệt nắng + lấp lánh, vệt trăng; mạnh dần theo độ chi tiết | `engine/env/envShader.ts` |
| Tuyến đường sắt | Vòng khép kín hình tự do chạy sát rìa thung lũng, 2–3 nhánh vươn vào núi tuyết; độ dốc ≤ ~6%; tự sinh đường hầm (có cửa hầm đá) khi xuyên núi, cầu cạn khi băng qua thung lũng giữa hai sườn núi, cầu qua sông | `himeji-castle/world/ValleyGen.ts`, `railMesh.ts` |
| Điều khiển | Phím mũi tên cho lái tàu / cano / đi bộ; bấm nút trong bảng cài đặt không còn "giữ" phím | cả 2 `ui/` |

**Còn thiếu so với kế hoạch gốc:** thuyền NPC khác, người dân lên xuống tàu, LOD cây ở xa, chạy sinh thế giới trong Worker (hiện chỉ ~60 ms nên chưa cần).


---

## Mục lục
1. [Mục tiêu & phạm vi](#1-mục-tiêu--phạm-vi)
2. [Quyết định công nghệ](#2-quyết-định-công-nghệ)
3. [Kiến trúc & cấu trúc thư mục](#3-kiến-trúc--cấu-trúc-thư-mục)
4. [Engine dùng chung (`packages/engine`)](#4-engine-dùng-chung)
5. [Keepsakeland: thiết kế chi tiết](#5-keepsakeland--thiết-kế-chi-tiết)
6. [Grand Valley: thiết kế chi tiết](#6-grand-valley--thiết-kế-chi-tiết)
7. [Pipeline asset & nội dung](#7-pipeline-asset--nội-dung)
8. [Ngân sách hiệu năng](#8-ngân-sách-hiệu-năng)
9. [Lộ trình theo giai đoạn (milestones)](#9-lộ-trình-theo-giai-đoạn)
10. [Kiểm thử & chất lượng](#10-kiểm-thử--chất-lượng)
11. [Rủi ro & phương án dự phòng](#11-rủi-ro--phương-án-dự-phòng)
12. [Các quyết định còn mở](#12-các-quyết-định-còn-mở)

---

## 1. Mục tiêu & phạm vi

### 1.1 Mục tiêu chung
- Chạy trên trình duyệt desktop và mobile, không cần cài đặt.
- Phong cách "cozy": low poly, toon shading, viền mực, noise giấy/màu nước, bảng màu dịu.
- 60 FPS trên laptop tầm trung, ≥ 30 FPS trên điện thoại tầm trung (2022+).
- Tải lần đầu nhanh: màn hình tương tác được trong < 5 giây với mạng 4G tốt.

### 1.2 Keepsakeland: phạm vi v1
| Có | Không (để sau) |
|---|---|
| 1 hành tinh (Sado) với 6 điểm kỷ niệm | Nhiều hành tinh (kiến trúc vẫn hỗ trợ sẵn) |
| Chế độ toàn cảnh: xoay, zoom, chạm để đi | Multiplayer |
| Nhân vật đi bộ/chạy trên mặt cầu (WASD, click-to-move, joystick cảm ứng) | Nhảy, leo, bơi |
| POI: banner tên địa điểm, "Xem ảnh [E]", gallery, nhật ký hành trình | Editor trong game |
| NPC đứng/làm việc tại chỗ, bướm, chim, mây | Hội thoại phân nhánh |
| Nhạc nền, âm thanh môi trường | Lồng tiếng |
| Song ngữ Việt/Nhật cho nội dung | Đa ngôn ngữ đầy đủ |

### 1.3 Grand Valley: phạm vi v1
| Có | Không (để sau) |
|---|---|
| Thung lũng sinh theo seed: địa hình, sông, đường ray vòng kín, cầu, 1–2 làng, rừng | Đường hầm, nhiều tuyến ray giao nhau |
| Tàu chạy tự động, dừng ga | Ghép/tách toa |
| **Lái tàu**: ga/phanh, góc nhìn buồng lái (cab view) | Bẻ ghi |
| **Lái thuyền** trên sông, va chạm bờ, sóng/vệt nước | Thuyền ra biển, câu cá |
| 6 camera: Overview, Train, Bridges, Passenger, Driver, Boat | Camera tự do bay (chỉ có trong debug) |
| Ngày/chiều/đêm, thời tiết nắng/mưa/tuyết, tốc độ thời gian | Mùa (xuân, hạ, thu, đông) |
| Cừu, người dân đi lang thang, bong bóng thoại | AI phức tạp |
| Panel Settings, lưu/chia sẻ map qua seed | Tự vẽ map bằng tay |
| Toggle pixel art / ink line | |

---

## 2. Quyết định công nghệ

| Hạng mục | Lựa chọn | Lý do |
|---|---|---|
| Ngôn ngữ | **TypeScript** (strict) | Code engine nhiều toán vector/quaternion, cần type để tránh lỗi |
| Build | **Vite** | Dev server nhanh, hỗ trợ shader `?raw`, build tối ưu |
| 3D | **Three.js thuần** (r17x+) | Game loop, instancing, shader cần kiểm soát chi tiết. Không cần lớp React ở phần 3D (xem mục 12) |
| UI overlay | HTML/CSS + TypeScript thuần (hoặc Preact nếu UI phình to) | UI ít, đơn giản; tránh để React re-render ảnh hưởng game loop |
| Monorepo | **pnpm workspaces** | Dùng chung `engine` giữa hai app |
| Noise | `simplex-noise` + RNG seed (`alea`) | Sinh tự động phải tất định (cùng seed → cùng map) |
| Post-processing | `three/examples/jsm/postprocessing` (EffectComposer) + pass tự viết | Outline, pixelate, paper noise |
| Model | glTF (`.glb`) + **Draco** (mesh) + **KTX2/Basis** (texture) | Chuẩn của web 3D, nhẹ |
| Audio | Web Audio qua `howler.js` | Ổn định trên iOS, có sprite và fade |
| Tween | Tự viết (spring/damp) + `@tweenjs/tween.js` cho cutscene | Camera cần damping liên tục, tween chỉ dùng cho chuyển cảnh |
| Debug | `lil-gui`, `stats-gl` | Chỉnh tham số trực tiếp khi chạy |
| Test | **Vitest** (logic, toán, tất định), Playwright (smoke test) | |
| Lint/format | ESLint + Prettier | |
| Deploy | Cloudflare Pages hoặc Vercel (static) | Giống hai trang tham khảo |

**Không dùng physics engine** (Rapier, Cannon) ở v1. Nhân vật trên mặt cầu, thuyền trên sông và tàu trên ray đều là chuyển động có ràng buộc, viết controller "kinematic" riêng sẽ đơn giản và ổn định hơn. Nếu sau này cần vật thể va đập thật thì thêm Rapier.

---

## 3. Kiến trúc & cấu trúc thư mục

```
g2/
├─ docs/
│  └─ PLAN.md                    ← tài liệu này
├─ packages/
│  └─ engine/                    ← dùng chung
│     └─ src/
│        ├─ core/                (App, Loop, Time, Events, StateMachine)
│        ├─ input/               (Keyboard, Pointer, Touch joystick, InputMap)
│        ├─ render/              (Renderer setup, ToonMaterial, Composer, passes, Palette)
│        ├─ camera/              (CameraRig, các CameraMode, SmoothDamp, Transition)
│        ├─ world/               (Noise, Rng, PoissonDisk, InstancedScatter, Spline utils)
│        ├─ character/           (CharacterController, GravityProvider, Animator)
│        ├─ assets/              (AssetLoader GLTF/Draco/KTX2, progress)
│        ├─ audio/               (AudioManager, music playlist, SFX)
│        ├─ ui/                  (Overlay, Prompt, Toast, Modal, LoadingScreen, styles)
│        ├─ save/                (Storage wrapper an toàn với localStorage)
│        └─ debug/               (Gui, Stats, Gizmos)
├─ apps/
│  ├─ keepsakeland/
│  │  ├─ public/islands/sado/   (island.json, photos/, audio/)
│  │  └─ src/
│  │     ├─ planet/              (PlanetGenerator, PlanetSurface, Water, Props)
│  │     ├─ player/              (SpherePlayer, ClickToMove)
│  │     ├─ modes/               (OverviewMode, FlyInMode, WalkMode, MapMode)
│  │     ├─ poi/                 (PoiSystem, PhotoViewer, Journal)
│  │     ├─ life/                (Npc, Butterflies, Birds, Clouds)
│  │     ├─ ui/
│  │     └─ main.ts
│  └─ himeji-castle/
│     └─ src/
│        ├─ gen/                 (WorldGenerator, Terrain, River, Rail, Bridges, Villages, Scatter, Fields)
│        ├─ train/               (Train, Carriage, TrainController, Stations, Smoke)
│        ├─ boat/                (Boat, BoatController, Wake)
│        ├─ cameras/             (Overview, TrainChase, Bridges, Passenger, Driver, BoatChase)
│        ├─ env/                 (TimeOfDay, Weather, Sky, Clouds, Stars)
│        ├─ life/                (Sheep, Villagers, SpeechBubbles, Balloons)
│        ├─ ui/                  (SettingsPanel, HUD)
│        └─ main.ts
├─ package.json / pnpm-workspace.yaml / tsconfig.base.json
```

### 3.1 Vòng lặp game (Loop)
- `requestAnimationFrame` → `update(dt)` → `render()`.
- **Fixed timestep** cho logic di chuyển (60 Hz, có accumulator) để controller ổn định khi FPS dao động. Render nội suy giữa hai trạng thái nếu cần.
- `dt` bị chặn trên (tối đa 0.1s) để tránh nhảy cóc khi tab bị ẩn rồi mở lại.
- Tạm dừng khi tab ẩn (`visibilitychange`).

### 3.2 Hệ thống system đơn giản (không cần ECS đầy đủ)
Mỗi phần là một class có `init()`, `update(dt)`, `dispose()`, được `App` đăng ký theo thứ tự cố định:
`Input → Gameplay (player/boat/train) → Life (NPC) → Camera → Env (sky, weather) → Audio → UI → Render`.

### 3.3 State machine cấp game
- Keepsakeland: `Loading → Intro (thẻ giới thiệu) → Overview ⇄ FlyIn → Walk ⇄ PhotoViewer / Journal / Map`
- Grand Valley: `Loading → Generating → Playing(cameraMode) ⇄ Settings`; mỗi `cameraMode` quyết định input đang điều khiển cái gì.

---

## 4. Engine dùng chung

### 4.1 Render stylized: phần quyết định "look"
| Thành phần | Cách làm | Ghi chú |
|---|---|---|
| **Palette** | File `palette.ts`, 12–16 màu đặt tên theo vai trò (grass, grassShade, rice, water, waterFoam, outline, sky...) | Mọi material lấy màu từ đây, không hard-code |
| **ToonMaterial** | Mở rộng `MeshStandardMaterial` qua `onBeforeCompile`: lượng tử hoá `NdotL` thành 2–3 bậc (smoothstep hẹp), bóng đổ cũng lượng tử hoá, màu vùng tối lệch về xanh lạnh (không chỉ tối đi) | Giữ được shadow map, fog, instancing của Three.js |
| **Noise trên bề mặt** | Trong shader: sample noise theo world position, pha lẫn 2 tông màu → hiệu ứng loang màu nước | Tham số: scale, strength |
| **Outline** | Post-process: đọc depth + normal buffer, Sobel → đường viền màu `palette.outline`, độ dày theo độ phân giải | Phương án dự phòng: inverted hull cho nhân vật/nhà |
| **Paper / grain pass** | Overlay noise tĩnh + vignette nhẹ | Tạo cảm giác "tranh vẽ" |
| **Pixelate pass** | `RenderPixelatedPass` hoặc render target độ phân giải thấp + nearest filter | Toggle trong settings |
| **Fog/atmosphere** | Fog theo khoảng cách, màu theo thời gian trong ngày | Grand Valley có thêm fog theo độ cao |
| **Shadow** | 1 directional light, PCF soft, shadow camera ôm vùng gần người chơi | Mobile: giảm kích thước map hoặc tắt |
| **Quality presets** | Low/Medium/High: DPR, shadow, outline, mật độ cỏ | Tự chọn mức theo FPS đo được 3 giây đầu |

### 4.2 Input
- `InputMap` ánh xạ hành động → phím: `move` (vector 2D), `run`, `interact` (E), `map` (M), `camera1..6`, `throttle`, `brake`, `pause`...
- Nguồn: bàn phím, chuột (kéo xoay, cuộn zoom, click), cảm ứng (joystick ảo bên trái, kéo màn hình bên phải để xoay camera, pinch zoom), gamepad (tuỳ chọn, để sau).
- Phân biệt **click** và **drag** (ngưỡng 5px / 200ms) để click-to-move không bị kích hoạt khi xoay camera.
- Khi focus đang ở UI (modal, input) thì chặn input game.

### 4.3 Camera
- `CameraRig` giữ một camera duy nhất, nhiều `CameraMode` đăng ký vào. Mỗi mode trả về **pose mong muốn** (position, lookAt/quaternion, up, fov).
- Rig làm mượt về pose đó bằng **critically damped spring** (SmoothDamp) để không giật và không vọt quá.
- `Transition`: khi đổi mode, nội suy pose cũ → mới trong 0.6–1.2s (easing). Riêng `up` vector dùng slerp quaternion.
- Hỗ trợ `up` vector bất kỳ (bắt buộc cho hành tinh cầu).

### 4.4 Character controller dùng chung
Thiết kế để dùng được cho **mặt cầu** (Keepsakeland) và **mặt phẳng có địa hình** (Grand Valley, nếu sau này cho đi bộ):

```ts
interface GravityProvider { up(position: Vector3): Vector3 }        // sphere: normalize(p); flat: (0,1,0)
interface GroundProvider  { heightAt(dir: Vector3): number; normalAt(...): Vector3 }
interface CollisionProvider { resolve(pos: Vector3, radius: number): Vector3 } // đẩy ra khỏi vật cản
```
Controller chỉ làm việc với các interface này nên không biết thế giới là cầu hay phẳng.

### 4.5 World utilities
- `Rng(seed)`: random tất định. **Không dùng `Math.random()` trong code sinh thế giới.**
- `fbm(noise, octaves, lacunarity, gain)`, ridged noise, domain warp.
- `PoissonDisk(region, minDist, densityFn)`: rải điểm đều tự nhiên.
- `InstancedScatter`: nhận danh sách transform → tạo `InstancedMesh` theo loại, tự chia cụm để frustum culling.
- Spline utils: arc-length parametrization, khoảng cách điểm → spline (dùng lưới tăng tốc).

### 4.6 Asset, Audio, UI, Save
- `AssetLoader`: một nơi duy nhất nạp glb/texture/audio, báo tiến độ cho LoadingScreen, cache, cấu hình sẵn Draco + KTX2 decoder.
- `AudioManager`: nhạc nền (playlist, crossfade), ambience theo vùng, SFX 3D (`PositionalAudio`), nút mute. Chỉ bắt đầu sau tương tác đầu tiên của người dùng (chính sách autoplay; giống "Tap for sound").
- UI kit: Button, Panel, Prompt bubble ("Xem ảnh [E]"), Toast, Modal, Title banner, phong cách bo góc dày + đổ bóng cứng như ảnh tham khảo. CSS variables cho màu.
- `Storage`: bọc `localStorage` trong try/catch, có version schema để migrate.

---

## 5. Keepsakeland: thiết kế chi tiết

### 5.1 Hành tinh
**Thông số gốc:** bán kính `R = 40` (đơn vị ≈ mét), mực nước `R_w = R - 0.6`.

**Hàm độ cao giải tích** là trung tâm của thiết kế: một hàm duy nhất `heightAt(dir)` dùng cho cả:
- dựng mesh (đỉnh = `dir * heightAt(dir)`),
- giữ nhân vật bám đất (không cần raycast mỗi frame),
- đặt cây, nhà, NPC,
- kiểm tra nước.

```
heightAt(dir) = R
  + fbm(dir * f1) * A_hills                         // đồi thoải
  + ridged(dir * f2) * A_mountain * mountainMask(dir) // núi ở vùng chỉ định
  - lakeMask(dir) * depth                            // hồ, vịnh
  then apply flattenZones                            // san phẳng ruộng lúa, nền nhà, đường
```

**Vùng (zones) do người thiết kế đặt trong `island.json`** theo kinh/vĩ độ: ruộng, núi, hồ, làng, bến cảng. Mỗi zone có tâm, bán kính góc và loại. Zone điều khiển: san phẳng, màu đất, loại vật thể được rải. Nhờ vậy hành tinh vừa tự nhiên (noise) vừa kể đúng câu chuyện địa điểm (thiết kế tay).

**Mesh:**
- `IcosahedronGeometry(R, detail≈64)` hoặc cube-sphere 6 mặt (phân bố đỉnh đều hơn, dễ chia chunk). **Chọn cube-sphere**: 6 mặt × lưới 96×96.
- `flatShading` + vertex color theo zone/độ cao/độ dốc (cỏ, đất, cát bờ, đá).
- Nước: quả cầu riêng bán kính `R_w`, shader nước có bọt trắng ở nơi gần bờ (so sánh `heightAt` với `R_w`, tính trước thành vertex attribute hoặc texture).
- Đường mòn: vẽ bằng màu vertex (đất nhạt) theo spline trên mặt cầu, đồng thời là gợi ý đường đi.

### 5.2 Đặt vật thể lên mặt cầu
```
position   = dir * heightAt(dir)
quaternion = fromUnitVectors(Y_UP, dir) * rotateAroundUp(randomYaw)
```
- Loại vật thể: cây (3–4 biến thể), bụi, đá, hoa, cỏ, lúa, nhà, cột điện + dây (catenary), cổng torii, máy cày, thuyền, bến tàu...
- Cây/cỏ/lúa/hoa: `InstancedMesh` + Poisson disk theo mật độ zone.
- Vật thể "kể chuyện" (nhà, máy cày, torii, phế tích mỏ vàng): đặt **thủ công** bằng toạ độ trong `island.json`.
- Cỏ và lúa: vertex shader gió (sin theo thời gian + world pos, đỉnh lá lay nhiều hơn gốc). Khi nhân vật đi qua, cỏ bị đẩy sang hai bên (truyền vị trí player vào uniform).

### 5.3 Điều khiển nhân vật trên mặt cầu (phần cốt lõi)
**Trạng thái:** `p` (vị trí), `f` (hướng mặt, luôn tiếp tuyến), `speed`, `vRadial` (vận tốc theo phương thẳng đứng, để rơi hoặc nhảy sau này).

**Mỗi bước cập nhật (fixed 60 Hz):**
1. `u = normalize(p)` là hướng lên tại chỗ đứng.
2. Lấy input 2D `(x, y)`, quy đổi theo **camera**:
   - `camF = normalize(camForward - u * dot(camForward, u))` (chiếu lên mặt phẳng tiếp tuyến)
   - `camR = cross(camF, u)`
   - `wish = normalize(camF * y + camR * x)`
3. Tăng/giảm tốc mượt tới `walkSpeed` (3.5) / `runSpeed` (7) khi giữ Shift.
4. Xoay `f` dần về `wish` (slerp quanh trục `u`, ~10 rad/s), nhân vật quay người tự nhiên.
5. Di chuyển: `p += wish * speed * dt`.
6. **Chiếu lại về mặt đất:** `dir = normalize(p)`, `p = dir * heightAt(dir)`.
7. **Parallel transport** hướng mặt: `f = normalize(f - dir * dot(f, dir))` để `f` vẫn tiếp tuyến ở vị trí mới. Không có bước này nhân vật sẽ "nghiêng" dần khi đi xa.
8. Va chạm:
   - Vật cản (cây, nhà, đá) là **hình tròn trên mặt phẳng tiếp tuyến** (tâm + bán kính, lưu trong lưới không gian theo ô kinh/vĩ). Bị chồng lấn thì đẩy ra theo pháp tuyến.
   - Nước: nếu `heightAt(dir) < R_w + 0.1` thì không cho đi tiếp (trượt dọc bờ).
   - Độ dốc: dốc > 40° thì chặn hoặc trượt.
9. Hướng xoay của model: dựng ma trận từ `(right, u, f)` → quaternion.

**Click-to-move:**
- Raycast chuột vào mesh hành tinh, lấy điểm đích `target`.
- Mỗi bước: `wish` = hướng tiếp tuyến từ `p` tới `target` (theo cung lớn).
- Tới nơi (khoảng cách góc < ngưỡng) thì dừng. Bị kẹt > 1s thì huỷ. Hiện marker vòng tròn tại đích.
- Bấm phím di chuyển thì huỷ click-to-move ngay.

**Joystick cảm ứng:** nửa trái màn hình là joystick động (xuất hiện tại chỗ chạm), nửa phải kéo để xoay camera.

**Animation:** model glTF có rig, `AnimationMixer` với `idle / walk / run`, blend theo `speed`. Bước chân phát SFX theo chất liệu mặt đất (cỏ, đất, gỗ) dựa vào zone.

### 5.4 Camera trên mặt cầu
| Mode | Mô tả | Chi tiết kỹ thuật |
|---|---|---|
| **Overview** | Nhìn cả hành tinh như ảnh 1 | Kéo để xoay: xoay camera quanh tâm hành tinh bằng quaternion (kiểu trackball có quán tính), không dùng `OrbitControls` mặc định vì cần xoay tự do mọi hướng. Cuộn hoặc pinch để zoom có giới hạn. Hành tinh tự xoay chậm khi idle. |
| **FlyIn** | Chạm một điểm → camera bay xuống | Đi theo cung: slerp hướng nhìn + giảm khoảng cách theo easing, `up` chuyển dần sang `u` của điểm đáp. Kết thúc thì nhân vật xuất hiện, chuyển sang Walk. |
| **Walk (third-person)** | Ảnh 2, 3 | Camera ở toạ độ cục bộ của nhân vật: `yaw` (kéo chuột), `pitch` (giới hạn -10°…60°), `distance` (cuộn 3…12). Vị trí = `p + rotate(offset, frame(u, f))`. `camera.up = u`. SmoothDamp. **Chống chui xuống đất**: nếu `|camPos| < heightAt(camDir) + 0.5` thì nâng lên. Va chạm với nhà: raycast ngắn từ nhân vật ra camera, nếu bị chắn thì kéo lại gần. |
| **Map (M)** | Bay ra overview, hiện marker POI + vị trí người chơi | Bấm M lần nữa: bay về chỗ cũ |
| **PhotoViewer** | Camera đứng yên, UI phủ lên | Input game bị khoá |

### 5.5 POI (điểm kỷ niệm)
Dữ liệu trong `island.json`:
```ts
interface Poi {
  id: string;
  name: { vi: string; ja: string };         // "Đồng lúa Kuninaka" / "国中平野"
  latLon: [number, number];                 // vị trí trên hành tinh
  radius: number;                           // bán kính góc vùng kích hoạt
  description: { vi: string; ja?: string };
  photos: { src: string; caption?: string; date?: string }[];
  ambience?: string;                        // âm thanh môi trường riêng
  cameraHint?: { yaw: number; pitch: number }; // góc đẹp khi bay tới
}
```
Luồng:
1. Vào vùng POI: banner tên địa điểm hiện góc dưới trái (ảnh 2) với hiệu ứng chữ, đổi ambience.
2. Đến gần tâm (< 4m): bubble "Xem ảnh [E]" nổi trên đầu (vị trí 3D chiếu ra màn hình).
3. Bấm E hoặc chạm bubble: mở **PhotoViewer** (lightbox, vuốt hoặc mũi tên, caption, ngày). Ảnh lazy-load.
4. Lần đầu xem: đánh dấu đã khám phá, bộ đếm `1/6` cập nhật, toast "Đã ghi vào nhật ký".
5. **Nhật ký (Journal)**: danh sách POI, đã thăm hiện ảnh thumbnail, chưa thăm hiện "???". Bấm vào POI đã thăm thì bay tới đó.
6. Lưu tiến độ vào `localStorage` theo `islandId`.
7. Hoàn thành 6/6: hiệu ứng nhỏ (pháo giấy, đổi nhạc) và mở khoá mục "Hành tinh khác".

### 5.6 Sự sống (life)
- **NPC**: model đơn giản, mỗi NPC có `routine`: đứng làm việc (anim gặt lúa, câu cá), đi tuần trên một đường (spline trên cầu), hoặc ngồi. Khi người chơi lại gần thì quay đầu nhìn, có thể hiện bubble 1 câu.
- **Bướm, chuồn chuồn**: boids đơn giản bay quanh hoa (ảnh 2 có bướm).
- **Chim**: đàn bay theo quỹ đạo quanh hành tinh.
- **Mây**: các cụm mesh "bông" (gộp nhiều sphere low poly) quay quanh hành tinh ở các độ cao khác nhau.
- **Xe, xe đạp**: chạy theo spline đường làng.

### 5.7 UI Keepsakeland
- **Intro card** (ảnh 1): nhãn "Vùng đất kỷ vật", tiêu đề "Sado 佐渡島", địa điểm + ngày, mô tả, nút "Bắt đầu khám phá", gợi ý điều khiển.
- **HUD** (ảnh 2): badge `佐渡島 SADO 1/6` góc trên trái; cột nút góc phải: hành tinh (về overview), nhật ký, nhạc, toàn màn hình; dòng gợi ý phím ở dưới (ẩn dần sau 10s).
- Responsive: mobile thì intro card thành bottom sheet, nút to hơn (≥ 44px).

### 5.8 Nhiều hành tinh (chuẩn bị sẵn kiến trúc)
`/islands/<id>/island.json` gồm `seed`, `radius`, `palette override`, `zones`, `props`, `pois`, `music`. Trang "Hành tinh khác" là một màn chọn các hành tinh nhỏ trôi nổi.

---

## 6. Grand Valley: thiết kế chi tiết

### 6.1 Kích thước & hệ toạ độ
- Thế giới phẳng `1024 × 1024` đơn vị, trục Y hướng lên.
- Địa hình chia **8 × 8 chunk** (mỗi chunk lưới 64 × 64) để frustum culling và LOD sau này.
- Rìa bản đồ: địa hình dâng lên thành vách núi hoặc rừng dày, kết hợp fog để giấu giới hạn (như ảnh 7, rìa có tường cây).

### 6.2 Pipeline sinh thế giới (tất định theo seed)
Chạy trong **Web Worker** để không đứng hình. Mỗi bước nhận output của bước trước:

| # | Bước | Mô tả | Output |
|---|---|---|---|
| 1 | **Base height** | fbm noise + mặt nạ "lòng chảo" (rìa cao, giữa thấp) | `heightGrid` |
| 2 | **River** | Chọn 2 điểm biên đối diện, sinh đường uốn lượn (random walk có ràng buộc + làm mượt Chaikin) → spline. Khoét lòng sông theo khoảng cách tới spline (profile hình chữ U, rộng 12–20). | `riverSpline`, `distToRiverGrid` |
| 3 | **Rail route** | Vòng kín quanh thung lũng: đặt 8–12 control point trên một ellipse nhiễu, đẩy tránh vùng quá dốc, tạo `CatmullRomCurve3(closed)`. Độ cao ray = độ cao địa hình **đã làm mượt mạnh** dọc spline (giới hạn độ dốc ray ≤ 3%). | `railSpline`, `railHeights` |
| 4 | **Cut & fill** | Sửa địa hình quanh ray: đắp nền hoặc xẻ đồi trong bán kính 6–10, mép chuyển mượt | `heightGrid` cập nhật |
| 5 | **Bridges** | Dọc ray: đoạn nào ray cao hơn mặt đất > 3m **hoặc** cắt qua sông thì đánh dấu là cầu (gom thành đoạn liên tục, đặt trụ mỗi 8m) | `bridgeSegments[]` |
| 6 | **Stations & villages** | Chọn 1–2 vị trí trên ray ở nơi bằng phẳng làm ga. Làng: rải nhà quanh ga theo Poisson, đường đất nối nhà → ga (A* trên lưới, chi phí theo độ dốc) | `stations`, `houses`, `roads` |
| 7 | **Biome mask** | Đồng cỏ (gần làng, đất bằng), rừng lá rộng, rừng thông (cao hơn), bãi cát (bờ sông), hoa | `biomeGrid` |
| 8 | **Scatter** | Poisson disk theo biome, **loại trừ** sông, ray, đường, nhà (dựa vào distance grid). Ra danh sách transform theo loại | `instances{type → Matrix4[]}` |
| 9 | **Decor** | Cối xay gió trên đồi, khinh khí cầu, hoa súng trên sông, đàn cừu ở đồng cỏ, đá ven sông | |

**Kiểm thử tất định:** test Vitest sinh map với cùng seed 2 lần, hash output phải giống nhau.

**Map settings** (như ảnh 5): seed, độ uốn sông, số làng, mật độ rừng, độ cao núi, nút "Regenerate". Lưu preset vào `localStorage`, chia sẻ qua URL `?seed=…&p=…`.

### 6.3 Dựng mesh từ dữ liệu
- **Terrain**: mỗi chunk một `BufferGeometry`, vertex color theo biome + độ dốc + độ cao, `flatShading`, ToonMaterial.
- **River**: ribbon mesh dọc spline (rộng theo spline), UV chạy dọc dòng chảy. Shader nước: màu theo độ sâu (so với terrain height texture), **bọt trắng ở mép** (khoảng cách tới bờ), các vệt sáng trôi theo UV, gợn sóng noise.
- **Rail**: hai thanh ray = extrude profile dọc spline; tà vẹt = InstancedMesh; đá ballast = dải mesh dưới ray.
- **Bridge**: module "nhịp cầu" (dầm đỏ như ảnh 6) lặp theo đoạn, trụ cầu kéo xuống tới mặt đất.
- **Trees, houses, rocks...**: InstancedMesh (mỗi loại × mỗi cụm chunk).
- **Clouds**: InstancedMesh của "cụm bông", trôi theo gió, có bóng mờ trên mặt đất (tuỳ chọn).

### 6.4 Tàu hoả
**Mô hình:** tàu chạy trên `railSpline` đã chuẩn hoá theo độ dài cung (arc length `s`).
```
locomotive.s += speed * dt              (mod tổng chiều dài, vì ray là vòng kín)
carriage[i].s  = locomotive.s - offset_i
pose(s)        = { pos: spline.getPointAt(s/L), tangent: getTangentAt(s/L) }
```
- Mỗi toa dùng **2 điểm bogie** (trước/sau) để tính hướng → toa vào cua tự nhiên, không bị "cứng".
- Độ nghiêng nhẹ khi vào cua (bank) theo độ cong.
- Bánh xe quay theo quãng đường đi được; khói: hệ hạt billboard (mesh "bông" nhỏ phóng to dần rồi mờ đi); còi + tiếng "xình xịch" có nhịp theo tốc độ.

**Chế độ tự động (AI):** chạy với tốc độ mục tiêu (từ slider "Train speed"), giảm tốc khi tới ga (profile phanh theo khoảng cách), dừng N giây, hành khách lên xuống (NPC đi vào đi ra), rồi chạy tiếp.

**Chế độ người lái (Driver):**
- `W`/`↑` tăng ga (throttle 0–100%), `S`/`↓` phanh, `Space` phanh khẩn, `H` còi.
- Vật lý 1 chiều đơn giản: `a = throttle * maxTraction - drag * v² - gravity * sin(slope) - brake`. Lên dốc chậm lại, xuống dốc nhanh hơn, để có "cảm giác lái".
- HUD buồng lái: đồng hồ tốc độ, cần ga, tín hiệu ga sắp tới.
- Ga: dừng đúng vạch thì được tính điểm hoặc hiện lời khen (tuỳ chọn, để vui).

### 6.5 Thuyền
- Chuyển động 2D trên mặt phẳng nước (XZ), Y = mặt nước + **bobbing** (sin + noise), nghiêng (pitch/roll) theo gia tốc và sóng.
- Điều khiển: `W/S` máy tiến/lùi, `A/D` bánh lái; lực rẽ tỉ lệ với tốc độ (đứng yên thì không rẽ được, như thuyền thật); quán tính và lực cản ngang lớn để không bị trượt ngang như xe.
- **Dòng chảy**: vector dọc tangent của `riverSpline` đẩy thuyền trôi về hạ lưu.
- **Va chạm bờ**: dùng `distToRiverGrid` + gradient của nó. Nếu `dist > halfWidth - boatRadius` thì đẩy ngược lại theo gradient và triệt tiêu thành phần vận tốc hướng vào bờ (nảy nhẹ + rung camera + SFX).
- Va chạm hoa súng, chân cầu: các hình tròn tĩnh.
- Hiệu ứng: vệt nước sau đuôi (trail mesh mờ dần), bọt ở mũi, sóng nhỏ trên mặt nước (ghi vị trí thuyền vào uniform của shader nước).
- Đi qua dưới cầu khi tàu đang chạy trên cầu: khoảnh khắc "wow" nên ưu tiên làm cho đẹp.
- Đổi thuyền: có 1 thuyền điều khiển + vài thuyền NPC chạy tự động theo spline.

### 6.6 Hệ camera (6 chế độ, phím 1–6)
| # | Mode | Điều khiển | Chi tiết |
|---|---|---|---|
| 1 | **Overview** | WASD/kéo chuột = pan, cuộn = zoom, chuột phải hoặc 2 ngón = xoay | Camera kiểu "map" nhìn chéo xuống (ảnh 6, 7), giới hạn trong biên bản đồ, độ cao tối thiểu theo địa hình. Click vào tàu hoặc thuyền thì chuyển sang mode tương ứng. |
| 2 | **Train (chase)** | Kéo chuột xoay quanh tàu | Bám sau đầu máy, nhìn hơi chếch từ trên. SmoothDamp để không giật khi vào cua. |
| 3 | **Bridges** | Phím ←/→ chuyển cầu | Camera cố định đặt sẵn tại mỗi cầu (vị trí đẹp được tính khi sinh map: bên hông cầu, thấp gần mặt nước), tự xoay theo tàu khi tàu đi qua. |
| 4 | **Passenger** | Kéo chuột để nhìn quanh (giới hạn góc) | Gắn vào ghế trong toa, nhìn ra cửa sổ. Khung cửa sổ là mesh nội thất toa hoặc overlay khung. |
| 5 | **Driver (cab view)** | Kéo chuột nhìn quanh trong cabin; W/S ga/phanh | Ảnh 8: gắn vào đầu máy, nhìn qua nóc nồi hơi, ống khói, khói bay qua đầu. Thêm rung nhẹ theo tốc độ, viền khung cabin (ảnh 8 có viền đỏ trên/dưới). FOV rộng hơn (70–75°). |
| 6 | **Boat** | WASD lái thuyền, kéo chuột xoay camera | Ảnh 4: camera sau và trên thuyền, nhìn về phía trước theo hướng thuyền với độ trễ. |

**Quy tắc chung:** đổi mode luôn có transition mượt (tránh "cắt" khó chịu), trừ khi người dùng bấm liên tục. Mode nào có thể điều khiển thì hiện gợi ý phím ở đáy màn hình.

### 6.7 Môi trường: ngày/đêm & thời tiết
- `timeOfDay ∈ [0, 24)`, tốc độ do slider "Time" điều khiển (0x…10x), có preset Day/Evening/Night (ảnh 5).
- **Keyframe màu** theo giờ: màu trời trên/dưới, màu sun light, cường độ, màu ambient, màu fog, màu viền outline. Nội suy giữa các keyframe.
- Hướng mặt trời quay theo giờ; ban đêm: mặt trăng làm light chính (yếu, xanh), sao (Points), cửa sổ nhà và đèn tàu phát sáng (emissive, bật theo ngưỡng giờ), có thể thêm bloom nhẹ.
- **Thời tiết**: Sunny / Cloudy / Rain / Snow.
  - Rain: hạt dạng vạch rơi (InstancedMesh hoặc Points), **chỉ trong hộp quanh camera** (di chuyển theo camera) nên không tốn; vòng gợn trên mặt sông; trời tối hơn; âm mưa.
  - Snow: hạt rơi chậm có lắc ngang; shader terrain/cây pha trắng theo `snowAmount` trên mặt hướng lên (dot(normal, up)).
  - Chuyển thời tiết từ từ (lerp các tham số trong 5–10s).

### 6.8 Sự sống
- **Cừu**: đàn theo boids (tách, gom, bám đàn) trong vùng đồng cỏ; thỉnh thoảng gặm cỏ (anim); né tàu.
- **Người dân**: đi giữa nhà ↔ ga trên đường đất; tại ga đợi tàu, lên/xuống toa.
- **Bong bóng thoại** (ảnh 6, 7): câu ngắn ngẫu nhiên từ một danh sách, hiện khi camera ở gần và đối tượng trong khung hình; nhiều nhất 2–3 bubble cùng lúc.
- Khinh khí cầu trôi chậm, cối xay gió quay, khói ống khói nhà (instanced puff).

### 6.9 UI Grand Valley
- "Tap for sound" khi vào lần đầu (mở khoá audio).
- Nút **Settings** ở đáy giữa, mở panel (ảnh 5): 6 nút camera, Day/Evening/Night, Weather, âm lượng, Train speed, Time scale; các mục gập: Map settings, Background music, Settings (chất lượng đồ hoạ, pixel art, ink line, hiện FPS).
- HUD theo mode: Driver hiện đồng hồ tốc độ, Boat hiện la bàn hoặc tốc độ nhỏ.
- Phím tắt: `1–6` camera, `Esc` đóng panel, `P` tạm dừng, `F` toàn màn hình.

---

## 7. Pipeline asset & nội dung

### 7.1 Nguồn model
| Loại | Cách có | Ghi chú |
|---|---|---|
| Cây, đá, bụi, hoa | Tự dựng trong Blender (rất đơn giản, 50–300 tam giác) hoặc Quaternius/Kenney (CC0) | Đồng bộ style: tán cây là khối đa diện, màu phẳng |
| Nhân vật chính | Model low poly có rig (tự làm hoặc Quaternius "Ultimate Modular Characters"), animation từ Mixamo | Cần idle/walk/run (+ chụp ảnh nếu muốn) |
| NPC | Biến thể màu áo, nón lá, mũ từ cùng một rig | Dùng chung animation |
| Nhà, torii, máy cày, xe, thuyền, đầu máy, toa, cầu | Tự dựng theo module trong Blender | Đây là phần tốn công nhất: lập danh sách và làm dần |
| Âm thanh | freesound.org (kiểm tra license), nhạc CC hoặc tự sáng tác | Ghi rõ credit |

### 7.2 Quy chuẩn xuất model
- Đơn vị mét, trục Y lên, gốc toạ độ ở **đáy** vật thể (để đặt lên mặt đất dễ).
- Không dùng texture ảnh nếu tránh được: dùng **vertex color** hoặc 1 texture palette 16×16 chung, để giữ style đồng nhất và nhẹ.
- Xuất `.glb` → chạy `gltf-transform optimize` (Draco, prune, dedup) bằng script `pnpm assets:build`.
- Mỗi model ≤ 2k tam giác (trừ nhân vật ≤ 5k, đầu máy ≤ 8k).

### 7.3 Ảnh kỷ niệm (Keepsakeland)
- Script resize thành 2 kích cỡ (thumbnail 320px, full 1600px), WebP chất lượng 80, xoá EXIF (vị trí GPS!), sinh `photos.json`.
- Lazy-load khi mở gallery; prefetch ảnh của POI kế tiếp khi người chơi lại gần.

---

## 8. Ngân sách hiệu năng

| Chỉ số | Keepsakeland | Grand Valley |
|---|---|---|
| Draw calls | ≤ 120 | ≤ 250 |
| Tam giác trên màn hình | ≤ 400k | ≤ 800k (desktop), ≤ 300k (mobile) |
| Tải lần đầu (JS + model, không tính ảnh) | ≤ 6 MB | ≤ 4 MB (phần lớn là sinh tự động) |
| Thời gian sinh map | - | ≤ 1.5s desktop, ≤ 4s mobile (trong Worker) |
| Bộ nhớ GPU | ≤ 200 MB | ≤ 300 MB |
| FPS | 60 desktop / 30+ mobile | 60 desktop / 30+ mobile |

**Kỹ thuật bắt buộc:** InstancedMesh, gộp geometry tĩnh, frustum culling theo cụm, DPR ≤ 2 (mobile ≤ 1.5), shadow map 1024–2048 chỉ quanh vùng nhìn, tắt outline hoặc giảm độ phân giải pass trên Low, LOD cho cây ở xa (Grand Valley: cây xa thay bằng billboard hoặc mesh 1 khối), dispose đúng cách khi regenerate map.

**Đo đạc:** `stats-gl` + `renderer.info` hiển thị trong debug overlay; mỗi milestone ghi lại số liệu trên 1 laptop + 1 điện thoại cố định.

---

## 9. Lộ trình theo giai đoạn

Ước lượng thời gian cho 1 người, part-time (~15–20 giờ/tuần). Đây là con số ước đoán, sẽ chỉnh lại sau M1.

### Giai đoạn A: Nền tảng (engine)
**M0: Khung dự án** *(2–3 ngày)*
- pnpm monorepo, Vite, TS strict, ESLint/Prettier, Vitest.
- `App` + Loop + resize + DPR + debug GUI + stats.
- Scene thử: một khối lập phương xoay.
- ✅ *Xong khi:* `pnpm dev` chạy cả hai app, test chạy được.

**M1: Look stylized** *(1–1.5 tuần)*
- Palette, ToonMaterial (onBeforeCompile), shadow lượng tử hoá.
- Outline pass (depth + normal), paper grain pass, pixelate pass, quality presets.
- Scene thử: vài cây, đá, nhà trên mặt đất phẳng.
- ✅ *Xong khi:* chụp màn hình scene thử "trông giống" ảnh tham khảo về style; bật/tắt từng pass trong GUI.

**M2: Input, Camera, Asset, Audio, UI kit** *(1 tuần)*
- InputMap (phím, chuột, cảm ứng, joystick ảo), CameraRig + SmoothDamp + Transition.
- AssetLoader (Draco/KTX2, progress), LoadingScreen.
- AudioManager (unlock, music, SFX), UI kit (Button, Panel, Prompt, Toast, Modal).
- ✅ *Xong khi:* scene thử có loading bar, nhạc bật/tắt, đổi 2 camera mode mượt.

### Giai đoạn B: Keepsakeland
**M3: Hành tinh** *(1–1.5 tuần)*
- Cube-sphere + `heightAt` + zones từ `island.json`, vertex color, nước có bọt bờ.
- Rải cây, cỏ, lúa (instanced + gió), props thủ công.
- Overview mode (xoay trackball có quán tính, zoom), mây quay quanh.
- ✅ *Xong khi:* đạt được khung cảnh tương tự ảnh 1 (ở mức prototype art).

**M4: Nhân vật & camera Walk** *(1.5–2 tuần)*  ← **rủi ro cao nhất, làm prototype sớm**
- SpherePlayer: di chuyển theo camera, parallel transport, chiếu lên mặt đất, va chạm tròn, nước, độ dốc.
- Camera Walk: yaw/pitch/zoom, `up` động, chống chui đất, chống chui tường.
- FlyIn từ Overview (chạm điểm → bay xuống → điều khiển).
- Click-to-move, joystick cảm ứng, animation idle/walk/run, tiếng bước chân.
- ✅ *Xong khi:* đi vòng quanh **toàn bộ** hành tinh (qua cả hai cực) không giật, không lật camera, không xuyên vật cản; chạy được trên điện thoại.

**M5: POI, nội dung, UI** *(1–1.5 tuần)*
- PoiSystem (vùng, banner, prompt E), PhotoViewer, Journal, tiến độ 1/6, lưu localStorage.
- Intro card, HUD, Map (M), nhạc + ambience theo vùng.
- Script xử lý ảnh, nhập nội dung 6 POI của Sado.
- ✅ *Xong khi:* chơi trọn vòng: intro → khám phá đủ 6/6 → màn hoàn thành.

**M6: Sự sống & đánh bóng, phát hành Keepsakeland** *(1–1.5 tuần)*
- NPC routine, bướm, chim, xe đạp; model "kể chuyện" thay placeholder.
- Tối ưu theo ngân sách, quality auto, test thiết bị, sửa lỗi.
- Deploy (Cloudflare Pages/Vercel), meta/OG image.
- ✅ *Xong khi:* đạt ngân sách mục 8, không lỗi chặn trên Chrome/Safari/Firefox + iOS/Android.

### Giai đoạn C: Grand Valley
**M7: Sinh thế giới** *(2–2.5 tuần)*  ← **rủi ro cao thứ hai**
- Worker + pipeline bước 1–9, distance grids, test tất định.
- Mesh terrain theo chunk, sông (shader nước), rừng instanced.
- Overview camera dạng map.
- ✅ *Xong khi:* 20 seed ngẫu nhiên đều cho ra map "hợp lý" (sông liền, ray không xuyên núi, cây không mọc trên ray/sông). Duyệt bằng màn hình "seed gallery" trong debug.

**M8: Đường ray, cầu, tàu** *(1.5–2 tuần)*
- Mesh ray, tà vẹt, ballast, cầu + trụ, ga.
- Train: arc-length, bogie, bank, khói, âm thanh, AI dừng ga.
- Camera 2 (Train), 3 (Bridges), 4 (Passenger), 5 (Driver) + chế độ lái tàu (ga/phanh, dốc, HUD).
- ✅ *Xong khi:* tàu chạy vòng mượt không giật ở mối nối spline; cab view như ảnh 8; tự lái được và dừng đúng ga.

**M9: Thuyền** *(1 tuần)*
- BoatController (lực đẩy, bánh lái, dòng chảy, va chạm bờ), bobbing, wake, gợn nước.
- Camera 6 (Boat), thuyền NPC, hoa súng.
- ✅ *Xong khi:* lái thuyền từ đầu sông đến cuối sông không kẹt, không xuyên bờ, đi dưới cầu được.

**M10: Môi trường, sự sống, UI, phát hành Grand Valley** *(1.5–2 tuần)*
- TimeOfDay (keyframe màu, đèn đêm, sao), Weather (mưa, tuyết, chuyển mượt).
- Cừu boids, người dân, bong bóng thoại, khinh khí cầu, cối xay.
- Settings panel đầy đủ, map settings + seed URL, nhạc nền.
- Tối ưu (LOD cây xa), test thiết bị, deploy.
- ✅ *Xong khi:* đạt ngân sách mục 8; mọi mục trong panel hoạt động.

### Tổng quan thời gian (ước lượng)
```
Tuần:  1   2   3   4   5   6   7   8   9  10  11  12  13  14  15  16  17  18  19
A    [M0][--M1--][M2]
B                    [--M3--][----M4----][--M5--][--M6--]
C                                                        [----M7----][--M8--][M9][--M10--]
```
≈ 4–5 tháng part-time cho cả hai. Có thể rút ngắn bằng cách dùng nhiều asset CC0 hơn và cắt bớt phần "Để sau".

### Prototype sớm (spike) để giảm rủi ro
Trước khi làm M1 đầy đủ, dành **2–3 ngày** cho một spike "xấu nhưng chạy": quả cầu + khối hộp làm nhân vật đi vòng quanh + camera bám theo. Nếu bước này ổn thì phần khó nhất của Keepsakeland đã được chứng minh.

---

## 10. Kiểm thử & chất lượng

| Loại | Nội dung | Công cụ |
|---|---|---|
| Unit | Toán controller (parallel transport giữ `f ⊥ u`, không trôi độ dài), arc-length spline, Poisson disk, SmoothDamp | Vitest |
| Tất định | Cùng seed → cùng hash map; khác seed → khác | Vitest |
| Bất biến sinh map | Không instance nào nằm trên sông/ray; ray không dốc quá 3%; sông liền mạch | Vitest (chạy 50 seed) |
| Smoke E2E | Mở trang, qua loading, không lỗi console, canvas có pixel | Playwright |
| Thủ công | Checklist mỗi milestone trên: Chrome, Safari, Firefox (macOS); Safari iOS; Chrome Android | |
| Hiệu năng | Ghi FPS, draw calls, thời gian tải mỗi milestone vào `docs/perf-log.md` | stats-gl, Lighthouse |

---

## 11. Rủi ro & phương án dự phòng

| Rủi ro | Mức | Phòng tránh / dự phòng |
|---|---|---|
| Camera/nhân vật trên mặt cầu bị giật, lật ở cực | Cao | Dùng quaternion + parallel transport, không dùng Euler/lat-lon cho chuyển động; làm spike sớm; test đi qua cực |
| Map sinh tự động xấu hoặc vô lý | Cao | Bộ ràng buộc + "seed gallery" để duyệt nhanh; có thể chọn tay danh sách seed đẹp làm mặc định |
| Không đạt style như tham khảo | Trung bình | Chốt palette + material ở M1 trước khi làm nội dung; so sánh song song với ảnh tham khảo |
| Hiệu năng mobile | Trung bình | Quality preset tự động; test điện thoại từ M1, không đợi đến cuối |
| Thiếu model (tốn công dựng) | Trung bình | Bắt đầu bằng asset CC0/placeholder, thay dần; dựng theo module tái dùng |
| Outline bị răng cưa hoặc nhiễu | Thấp | Chỉnh ngưỡng depth/normal; fallback inverted hull |
| Audio không phát trên iOS | Thấp | Unlock audio ở tương tác đầu tiên ("Tap for sound") |
| Lộ dữ liệu cá nhân trong ảnh (GPS EXIF) | Thấp | Script xử lý ảnh xoá EXIF bắt buộc |

---

## 12. Các quyết định còn mở

Cần chốt trước hoặc trong M0:

1. **Three.js thuần hay React Three Fiber?** Kế hoạch đang đề xuất **Three.js thuần** cho phần 3D (kiểm soát game loop, hiệu năng, controller) và HTML/TS cho UI. Nếu bạn muốn tận dụng React (đã quen), phương án khác là R3F + drei. Kiến trúc mục 3–4 vẫn áp dụng, nhưng code sẽ viết dạng component.
2. **Nội dung Keepsakeland:** dùng ảnh và câu chuyện thật của bạn (chuyến Sado?) hay nội dung mẫu trước?
3. **Asset:** tự dựng trong Blender hay ưu tiên CC0 rồi thay dần?
4. **Ngôn ngữ giao diện:** Việt + Nhật như tham khảo, có thêm tiếng Anh không?
5. **Có cho nhân vật đi bộ trong Grand Valley không** (xuống tàu, đi dạo làng)? Engine đã chuẩn bị `GravityProvider` phẳng nên làm được, nhưng sẽ tăng phạm vi (đề xuất để v2).
6. **Hosting:** Cloudflare Pages hay Vercel.
