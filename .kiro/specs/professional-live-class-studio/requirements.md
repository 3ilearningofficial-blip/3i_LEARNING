# Requirements Document

## Introduction

This feature replaces the current unprofessional live class system with a proper live streaming studio for the 3i Learning admin panel. The new system introduces a two-phase flow: a schedule form (without a YouTube URL field) followed by a full-screen Studio Setup page where the admin configures the stream source (WebRTC or RTMP/YouTube) before going live. Once live, a full-screen Broadcast page provides camera/mic/screen-share controls, a real-time chat panel, and a students-online panel. WebRTC sessions are auto-recorded and saved to Cloudflare R2, then converted into course lectures. The admin panel runs primarily on web browser (React Native Web + Expo).

## Glossary

- **Studio**: The full-screen page shown after the admin taps "Start Live" or "Go Live", used to configure stream settings before broadcasting.
- **Broadcast_Page**: The full-screen page shown after the admin taps "Go Live" inside the Studio; the active live session view.
- **Control_Panel**: The right-side 1/4 panel inside the Studio containing stream source selection and settings.
- **WebRTC**: Browser-native peer-to-peer video/audio streaming using the system webcam and microphone.
- **RTMP_Stream**: A YouTube live stream embedded via a YouTube URL/stream key entered in the Studio.
- **Schedule_Form**: The modal form used to create or schedule a live class (title, course, time, viewer count toggle, chat mode).
- **Live_Class**: A database record in the `live_classes` table representing a scheduled or active class session.
- **Recording**: A video file captured from a WebRTC session and stored in Cloudflare R2.
- **R2_Storage**: Cloudflare R2 object storage used to persist recordings.
- **Chat_Panel**: The right-side tab in the Broadcast_Page showing real-time messages from students and the teacher.
- **Students_Panel**: The right-side tab in the Broadcast_Page showing a list of currently watching students.
- **Hand_Raise**: A feature allowing students to signal they want to ask a question during a live session.
- **Admin**: The teacher/administrator who creates and manages live classes.
- **Student**: An enrolled user who watches live classes.
- **System**: The 3i Learning web application (React Native Web + Expo frontend + Express backend).

---

## Requirements

### Requirement 1: Schedule Form Redesign

**User Story:** As an Admin, I want a simplified schedule form without a YouTube URL field, so that stream configuration is deferred to the Studio and the scheduling step stays focused.

#### Acceptance Criteria

1. THE Schedule_Form SHALL contain the following fields: class title (required), course selector (required), scheduled date and time, viewer count toggle (show/hide), and chat mode selector (Public or Private).
2. THE Schedule_Form SHALL NOT contain a YouTube URL input field.
3. THE Schedule_Form SHALL display a "Start Live" button that, when tapped, creates the Live_Class record and immediately opens the Studio.
4. WHEN the Admin taps "Start Live" with no scheduled time provided, THE System SHALL set `scheduled_at` to the current timestamp and `is_live` to false, then open the Studio.
5. WHEN the Admin taps "Start Live" with a future scheduled time, THE System SHALL set `scheduled_at` to that future timestamp and `is_live` to false, then open the Studio.
6. THE Schedule_Form SHALL retain the viewer count toggle and chat mode (Public/Private) fields that were previously available.
7. WHEN the Admin edits an existing Live_Class, THE Schedule_Form SHALL pre-fill all retained fields with the existing values.

---

### Requirement 2: Scheduled Card "Go Live" Button Opens Studio

**User Story:** As an Admin, I want the "Go Live" button on a scheduled class card to open the Studio instead of immediately starting the class, so that I can configure my stream source before broadcasting.

#### Acceptance Criteria

1. WHEN the Admin taps "Go Live" on a scheduled Live_Class card, THE System SHALL navigate to the Studio for that Live_Class.
2. THE Studio SHALL display a back button in the top-left corner that returns the Admin to the previous screen without starting the broadcast.
3. WHEN the Admin navigates back from the Studio without tapping "Go Live", THE System SHALL NOT change the `is_live` status of the Live_Class.

---

### Requirement 3: Studio Setup Page Layout

**User Story:** As an Admin, I want a full-screen Studio Setup page with a live preview and a control panel, so that I can see and configure my stream before going live.

#### Acceptance Criteria

1. THE Studio SHALL occupy the full screen with a back button in the top-left corner.
2. THE Studio SHALL allocate 3/4 of the horizontal width to a live preview area and 1/4 to the Control_Panel.
3. WHEN WebRTC is selected, THE Studio SHALL display the local camera feed in the live preview area.
4. WHEN RTMP_Stream is selected, THE Studio SHALL display a placeholder or preview in the live preview area indicating the YouTube stream will be shown after going live.
5. THE Control_Panel SHALL contain: stream source selector (WebRTC or RTMP), stream-specific settings, viewer count toggle, chat mode selector, and a "Go Live" button at the bottom-right.

---

### Requirement 4: WebRTC Stream Source Configuration

**User Story:** As an Admin, I want to select WebRTC as my stream source and choose my camera and microphone, so that I can broadcast directly from my browser without a third-party tool.

#### Acceptance Criteria

1. WHEN the Admin selects the WebRTC option in the Control_Panel, THE System SHALL display a camera selector populated with available video input devices.
2. WHEN the Admin selects the WebRTC option in the Control_Panel, THE System SHALL display a microphone selector populated with available audio input devices.
3. WHEN the Admin changes the selected camera, THE Studio live preview SHALL update to show the feed from the newly selected camera.
4. WHEN the Admin changes the selected microphone, THE System SHALL switch the active audio input to the newly selected microphone.
5. IF the browser denies camera or microphone permission, THEN THE System SHALL display a descriptive error message instructing the Admin to grant permissions.
6. THE System SHALL request camera and microphone permissions using the browser MediaDevices API only when WebRTC is selected.

---

### Requirement 5: RTMP Stream Source Configuration

**User Story:** As an Admin, I want to select RTMP as my stream source and enter a YouTube live stream URL, so that I can broadcast via YouTube without exposing the URL in the schedule form.

#### Acceptance Criteria

1. WHEN the Admin selects the RTMP_Stream option in the Control_Panel, THE System SHALL display a text input for the YouTube stream URL.
2. THE System SHALL store the YouTube stream URL on the Live_Class record when the Admin taps "Go Live" from the Studio.
3. IF the Admin taps "Go Live" with RTMP selected and no YouTube URL entered, THEN THE System SHALL display a validation error and SHALL NOT start the broadcast.
4. THE System SHALL accept YouTube live stream URLs in standard formats (e.g., `https://youtube.com/live/...`, `https://youtu.be/...`).

---

### Requirement 6: Studio "Go Live" Action

**User Story:** As an Admin, I want a "Go Live" button in the Studio that starts the broadcast, so that I can transition from setup to the live session in one tap.

#### Acceptance Criteria

1. WHEN the Admin taps "Go Live" in the Studio with WebRTC selected, THE System SHALL set `is_live = true` on the Live_Class record and navigate to the Broadcast_Page in WebRTC mode.
2. WHEN the Admin taps "Go Live" in the Studio with RTMP selected and a valid YouTube URL entered, THE System SHALL save the YouTube URL to the Live_Class record, set `is_live = true`, and navigate to the Broadcast_Page in RTMP mode.
3. THE "Go Live" button SHALL be positioned at the bottom-right of the Control_Panel.
4. WHILE the "Go Live" action is in progress, THE System SHALL display a loading indicator on the "Go Live" button and disable further taps.

---

### Requirement 7: WebRTC Broadcast Page

**User Story:** As an Admin, I want a full-screen broadcast page when using WebRTC, so that I can manage my camera, mic, and screen share while monitoring chat and students.

#### Acceptance Criteria

1. THE Broadcast_Page SHALL occupy the full screen with a 3/4 left area for the live stream and 1/4 right area for the side panel.
2. THE left area SHALL display the Admin's live camera feed via WebRTC.
3. THE left area SHALL contain a camera on/off toggle icon.
4. THE left area SHALL contain a microphone on/off toggle icon.
5. THE left area SHALL contain a screen share button that opens the browser's native screen/window/tab picker.
6. WHEN the Admin activates screen share, THE System SHALL replace the camera feed in the left area with the screen share stream.
7. WHEN the Admin activates screen share, THE System SHALL auto-record the screen share stream.
8. THE right area SHALL contain two tabs: "Chat" and "Students".
9. THE Broadcast_Page SHALL display an "End Class" button at the bottom-right of the right panel.

---

### Requirement 8: RTMP Broadcast Page

**User Story:** As an Admin, I want a broadcast page when using RTMP that embeds the YouTube stream, so that I can monitor the live class and manage chat while streaming via YouTube.

#### Acceptance Criteria

1. WHEN the Broadcast_Page is in RTMP mode, THE left area SHALL display the YouTube live stream embed using the stored YouTube URL.
2. THE Broadcast_Page in RTMP mode SHALL use the same 3/4 left + 1/4 right layout as the WebRTC Broadcast_Page.
3. THE right area in RTMP mode SHALL contain the same "Chat" and "Students" tabs as the WebRTC Broadcast_Page.
4. THE Broadcast_Page in RTMP mode SHALL display an "End Class" button at the bottom-right of the right panel.

---

### Requirement 9: Chat Panel (Broadcast Page)

**User Story:** As an Admin, I want a real-time chat panel during the broadcast, so that I can read and respond to student messages.

#### Acceptance Criteria

1. THE Chat_Panel SHALL display messages from both students and the Admin in real time, polling at most every 3 seconds.
2. THE Chat_Panel SHALL visually distinguish Admin messages from student messages (e.g., different background color and a "TEACHER" badge).
3. WHEN the chat mode is set to Private, THE System SHALL hide other students' messages from student views, showing only the Admin's messages and the student's own messages.
4. WHEN the chat mode is set to Public, THE System SHALL show all messages to all participants.
5. THE Admin SHALL be able to delete any chat message from the Chat_Panel.
6. THE Chat_Panel SHALL display a hand-raise indicator showing the count of students who have raised their hand.
7. THE Admin SHALL be able to dismiss individual raised hands from the Chat_Panel.

---

### Requirement 10: Students Panel (Broadcast Page)

**User Story:** As an Admin, I want a students panel showing who is currently watching, so that I can monitor attendance during the live session.

#### Acceptance Criteria

1. THE Students_Panel SHALL display a list of students currently watching the live class, refreshing at most every 10 seconds.
2. THE Students_Panel SHALL show each student's name.
3. WHERE the viewer count toggle is enabled, THE Students_Panel SHALL display the total viewer count.

---

### Requirement 11: Student Hand Raise and Voice Doubt

**User Story:** As a Student, I want to raise my hand and use my microphone to ask a doubt during a live class, so that I can interact with the teacher in real time.

#### Acceptance Criteria

1. WHEN a Student taps the raise-hand button, THE System SHALL record the hand raise and notify the Admin in the Chat_Panel.
2. WHEN a Student taps the raise-hand button again after raising, THE System SHALL lower the hand and remove the notification from the Admin's view.
3. WHERE the platform is web, THE System SHALL provide a microphone button in the chat input area for voice-to-text input.
4. WHEN a Student activates voice input, THE System SHALL use the browser Speech Recognition API to transcribe speech and populate the chat input field.
5. IF the browser does not support the Speech Recognition API, THEN THE System SHALL hide the microphone button.

---

### Requirement 12: WebRTC Auto-Recording

**User Story:** As an Admin, I want WebRTC sessions to be automatically recorded, so that students can watch the class later as a lecture.

#### Acceptance Criteria

1. WHEN the Admin activates screen share during a WebRTC broadcast, THE System SHALL begin recording the screen share stream using the browser MediaRecorder API.
2. THE System SHALL record in a format compatible with Cloudflare R2 storage and standard video players (e.g., WebM or MP4).
3. WHEN the Admin taps "End Class" after a WebRTC session with an active recording, THE System SHALL stop the MediaRecorder and upload the recorded file to R2_Storage.
4. WHEN the recording upload to R2_Storage completes, THE System SHALL create a new lecture record in the course associated with the Live_Class, with the R2 URL as the video source.
5. WHEN the recording upload to R2_Storage completes, THE System SHALL set `is_completed = true` on the Live_Class record.
6. IF the recording upload to R2_Storage fails, THEN THE System SHALL display a descriptive error message to the Admin and SHALL NOT mark the Live_Class as completed.
7. THE System SHALL update the course's `total_lectures` count after the lecture record is created.

---

### Requirement 13: End Class Action

**User Story:** As an Admin, I want an "End Class" button that cleanly terminates the broadcast and handles post-session cleanup, so that students are notified the class has ended.

#### Acceptance Criteria

1. WHEN the Admin taps "End Class", THE System SHALL display a confirmation dialog before ending the session.
2. WHEN the Admin confirms ending the class, THE System SHALL set `is_live = false` and `is_completed = true` on the Live_Class record.
3. WHEN the Admin confirms ending a WebRTC class with no active screen share recording, THE System SHALL set `is_completed = true` without creating a lecture record.
4. WHEN the Admin confirms ending an RTMP class, THE System SHALL set `is_completed = true` and create a lecture record using the stored YouTube URL as the video source.
5. AFTER ending the class, THE System SHALL navigate the Admin back to the admin panel.

---

### Requirement 14: Database Schema Additions

**User Story:** As a developer, I want the database schema to support the new studio fields, so that stream source, chat mode, and recording URL are persisted correctly.

#### Acceptance Criteria

1. THE System SHALL add a `stream_type` column (TEXT, values: `'webrtc'` or `'rtmp'`) to the `live_classes` table.
2. THE System SHALL add a `chat_mode` column (TEXT, values: `'public'` or `'private'`, default `'public'`) to the `live_classes` table.
3. THE System SHALL add a `recording_url` column (TEXT, nullable) to the `live_classes` table to store the R2 URL of the WebRTC recording.
4. THE System SHALL add a `show_viewer_count` column (BOOLEAN, default TRUE) to the `live_classes` table if it does not already exist.
5. THE System SHALL perform all schema additions as `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` migrations at server startup.
```
