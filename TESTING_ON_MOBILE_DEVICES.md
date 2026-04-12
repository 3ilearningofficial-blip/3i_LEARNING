# Testing Your App on Android & iPhone

## 🚀 Quick Methods to Test

### Method 1: Expo Go App (Fastest - Development Testing)

**For Android:**
```bash
# In your project terminal
npx expo start

# Then:
1. Install "Expo Go" app from Google Play Store
2. Scan the QR code shown in terminal
3. App opens in Expo Go
```

**For iPhone:**
```bash
# In your project terminal
npx expo start

# Then:
1. Install "Expo Go" app from App Store
2. Scan the QR code with iPhone camera
3. Tap notification to open in Expo Go
```

**Limitations:**
- ❌ Some native features may not work
- ❌ Cannot test app icon/splash screen
- ❌ Cannot test production performance
- ✅ Good for quick UI/feature testing

---

### Method 2: Development Build (Recommended - Full Testing)

**For Android:**
```bash
# Build development APK
npx eas build --profile development --platform android

# After build completes:
1. Download APK from Expo dashboard
2. Transfer to Android phone
3. Install APK (enable "Install from unknown sources")
4. Open app
```

**For iPhone:**
```bash
# Build development IPA (requires Apple Developer account)
npx eas build --profile development --platform ios

# After build completes:
1. Download from Expo dashboard
2. Install via TestFlight or direct install
```

**Benefits:**
- ✅ Tests all native features
- ✅ Tests real performance
- ✅ Tests screen protection (FLAG_SECURE)
- ✅ Tests offline downloads
- ✅ Tests encryption

---

### Method 3: Production Build (Final Testing)

**For Android:**
```bash
# Build production APK/AAB
npx eas build --profile production --platform android

# Install on device for final testing
```

**For iPhone:**
```bash
# Build production IPA
npx eas build --profile production --platform ios

# Test via TestFlight before App Store submission
```

---

## 📱 Step-by-Step: Testing on Your Own Devices

### Option A: Using Expo Go (5 minutes)

**Android:**
1. Open Google Play Store on your Android phone
2. Search "Expo Go" and install
3. On your computer, run: `npx expo start`
4. Open Expo Go app on phone
5. Tap "Scan QR code"
6. Scan the QR code from your terminal
7. App loads automatically

**iPhone:**
1. Open App Store on your iPhone
2. Search "Expo Go" and install
3. On your computer, run: `npx expo start`
4. Open iPhone Camera app
5. Point at QR code in terminal
6. Tap notification that appears
7. App opens in Expo Go

---

### Option B: Using EAS Build (30 minutes)

**Prerequisites:**
```bash
# Install EAS CLI
npm install -g eas-cli

# Login to Expo account
eas login

# Configure project
eas build:configure
```

**Build for Android:**
```bash
# Create development build
eas build --profile development --platform android

# Wait 10-15 minutes for build to complete
# Download APK from: https://expo.dev/accounts/[your-account]/projects/[project]/builds

# Transfer APK to Android phone:
# - Email it to yourself
# - Use Google Drive
# - Use USB cable
# - Use ADB: adb install app.apk

# On Android phone:
# 1. Open downloaded APK
# 2. Allow "Install from unknown sources" if prompted
# 3. Install and open
```

**Build for iPhone:**
```bash
# Requires Apple Developer account ($99/year)
eas build --profile development --platform ios

# After build:
# 1. Download IPA from Expo dashboard
# 2. Install via TestFlight or Xcode
```

---

## 🧪 Complete Testing Checklist

### 1. Authentication Features

**Test on Android:**
- [ ] Phone number login with OTP
- [ ] OTP SMS received
- [ ] Session persists after app restart
- [ ] Logout works

**Test on iPhone:**
- [ ] Phone number login with OTP
- [ ] OTP SMS received
- [ ] Session persists after app restart
- [ ] Logout works

---

### 2. Video Playback

**Test on Android:**
- [ ] YouTube videos play
- [ ] Cloudflare Stream videos play
- [ ] Direct video files play
- [ ] Video controls work
- [ ] Fullscreen works
- [ ] **Watermark appears every 3 seconds**
- [ ] Watermark shows correct phone number
- [ ] Watermark moves to random positions

**Test on iPhone:**
- [ ] YouTube videos play
- [ ] Cloudflare Stream videos play
- [ ] Direct video files play
- [ ] Video controls work
- [ ] Fullscreen works
- [ ] **Watermark appears every 3 seconds**
- [ ] Watermark shows correct phone number
- [ ] Watermark moves to random positions

---

### 3. Screen Protection

**Test on Android:**
- [ ] Take screenshot during video → Should be BLACK
- [ ] Screen recording during video → Should be BLACK
- [ ] Screenshot on other screens → Works normally
- [ ] FLAG_SECURE working

**Test on iPhone:**
- [ ] Take screenshot during video → Should be BLACK or blurred
- [ ] Screen recording during video → Should be BLACK
- [ ] Screenshot on other screens → Works normally
- [ ] Screen protection working

---

### 4. Offline Downloads

**Test on Android:**
- [ ] Download lecture video
- [ ] Download study material (PDF)
- [ ] Progress bar shows correctly
- [ ] Downloaded files appear in "My Downloads"
- [ ] Play downloaded video offline (turn off WiFi)
- [ ] Open downloaded PDF offline
- [ ] Delete downloaded file
- [ ] Storage space updates correctly

**Test on iPhone:**
- [ ] Download lecture video
- [ ] Download study material (PDF)
- [ ] Progress bar shows correctly
- [ ] Downloaded files appear in "My Downloads"
- [ ] Play downloaded video offline (turn off WiFi)
- [ ] Open downloaded PDF offline
- [ ] Delete downloaded file
- [ ] Storage space updates correctly

---

### 5. Live Classes

**Test on Android:**
- [ ] Join live class
- [ ] Video plays smoothly
- [ ] Chat messages send/receive
- [ ] Raise hand works
- [ ] Watermark appears on live video
- [ ] Can see other students' messages

**Test on iPhone:**
- [ ] Join live class
- [ ] Video plays smoothly
- [ ] Chat messages send/receive
- [ ] Raise hand works
- [ ] Watermark appears on live video
- [ ] Can see other students' messages

---

### 6. Course Features

**Test on Android:**
- [ ] Browse courses
- [ ] View course details
- [ ] Enroll in course
- [ ] View lectures list
- [ ] Mark lecture as complete
- [ ] Progress updates correctly
- [ ] View study materials
- [ ] Download study materials

**Test on iPhone:**
- [ ] Browse courses
- [ ] View course details
- [ ] Enroll in course
- [ ] View lectures list
- [ ] Mark lecture as complete
- [ ] Progress updates correctly
- [ ] View study materials
- [ ] Download study materials

---

### 7. Tests/Quizzes

**Test on Android:**
- [ ] View available tests
- [ ] Start test
- [ ] Answer questions
- [ ] Submit test
- [ ] View results
- [ ] View correct answers
- [ ] Test timer works

**Test on iPhone:**
- [ ] View available tests
- [ ] Start test
- [ ] Answer questions
- [ ] Submit test
- [ ] View results
- [ ] View correct answers
- [ ] Test timer works

---

### 8. Profile & Settings

**Test on Android:**
- [ ] View profile
- [ ] Edit profile (name, DOB)
- [ ] Upload profile photo
- [ ] Photo appears correctly
- [ ] View enrolled courses
- [ ] View test history
- [ ] View notifications

**Test on iPhone:**
- [ ] View profile
- [ ] Edit profile (name, DOB)
- [ ] Upload profile photo
- [ ] Photo appears correctly
- [ ] View enrolled courses
- [ ] View test history
- [ ] View notifications

---

### 9. Performance Testing

**Test on Android:**
- [ ] App launches in < 3 seconds
- [ ] Videos load in < 5 seconds
- [ ] Smooth scrolling
- [ ] No crashes
- [ ] No memory leaks (use for 30 minutes)
- [ ] Battery usage acceptable

**Test on iPhone:**
- [ ] App launches in < 3 seconds
- [ ] Videos load in < 5 seconds
- [ ] Smooth scrolling
- [ ] No crashes
- [ ] No memory leaks (use for 30 minutes)
- [ ] Battery usage acceptable

---

### 10. Network Conditions

**Test on Android:**
- [ ] Works on WiFi
- [ ] Works on 4G/5G
- [ ] Works on slow 3G
- [ ] Handles network loss gracefully
- [ ] Reconnects automatically
- [ ] Shows appropriate error messages

**Test on iPhone:**
- [ ] Works on WiFi
- [ ] Works on 4G/5G
- [ ] Works on slow 3G
- [ ] Handles network loss gracefully
- [ ] Reconnects automatically
- [ ] Shows appropriate error messages

---

## 🎥 Testing Video Watermark Specifically

### Critical Test: Screen Recording

**Android:**
1. Open a lecture video
2. Start screen recording (swipe down → Screen Record)
3. Let video play for 30 seconds
4. Stop recording
5. **Check recording**: Should see watermark with your phone number appearing multiple times

**iPhone:**
1. Open a lecture video
2. Start screen recording (Control Center → Record)
3. Let video play for 30 seconds
4. Stop recording
5. **Check recording**: Should see watermark with your phone number appearing multiple times

**Expected Result:**
- Watermark appears ~10 times in 30 seconds
- Shows your phone number (formatted: XXXXX XXXXX)
- Shows your name
- Appears at different positions each time

---

## 🐛 Common Issues & Solutions

### Issue: "Expo Go can't open this app"
**Solution:** Your app uses custom native code. Use EAS Build instead.

### Issue: APK won't install on Android
**Solution:** 
1. Go to Settings → Security
2. Enable "Install from unknown sources"
3. Try installing again

### Issue: Videos don't play
**Solution:**
1. Check internet connection
2. Check if video URL is correct
3. Check server is running
4. Check .env file has correct API URL

### Issue: Watermark not appearing
**Solution:**
1. Check if user has phone number in profile
2. Check if video is actually playing (not paused)
3. Check console for errors
4. Verify VideoWatermark component is imported

### Issue: Screen protection not working
**Solution:**
1. Only works in production builds (not Expo Go)
2. Build with: `eas build --profile production`
3. Test on real device, not emulator

### Issue: Downloads not working
**Solution:**
1. Check if download_allowed is true for lecture
2. Check if user is enrolled in course
3. Check server logs for token generation
4. Check device storage space

---

## 📊 Testing Priority

### High Priority (Must Test):
1. ✅ Video playback (all types)
2. ✅ Watermark display
3. ✅ Screen protection
4. ✅ Authentication/Login
5. ✅ Offline downloads

### Medium Priority (Should Test):
1. ✅ Live classes
2. ✅ Tests/Quizzes
3. ✅ Course enrollment
4. ✅ Profile editing
5. ✅ Notifications

### Low Priority (Nice to Test):
1. ✅ UI animations
2. ✅ Loading states
3. ✅ Error messages
4. ✅ Edge cases

---

## 🚀 Quick Start Commands

```bash
# Test on Expo Go (fastest)
npx expo start

# Build for Android (development)
eas build --profile development --platform android

# Build for iPhone (development)
eas build --profile development --platform ios

# Build for both platforms
eas build --profile development --platform all

# Check build status
eas build:list

# View logs
npx expo start --clear
```

---

## 📱 Recommended Testing Devices

### Minimum:
- 1 Android phone (any version 8.0+)
- 1 iPhone (any iOS 13+)

### Ideal:
- 1 Budget Android (test performance)
- 1 Flagship Android (test features)
- 1 Older iPhone (iOS 13-14)
- 1 New iPhone (iOS 15+)

### You Can Test With:
- Your personal phone
- Friend's/family's phone
- Borrowed device
- Emulator (limited testing)

---

## 💡 Pro Tips

1. **Start with Expo Go** for quick UI testing
2. **Use EAS Build** for full feature testing
3. **Test on real devices**, not just emulators
4. **Test on different network speeds** (WiFi, 4G, 3G)
5. **Test with different user accounts**
6. **Record screen while testing** to catch bugs
7. **Keep a testing checklist** (use the one above)
8. **Test after every major change**

---

## 🎯 Fastest Way to Test Everything

**Day 1: Basic Testing (Expo Go)**
```bash
npx expo start
# Test on your phone via Expo Go
# Check: UI, navigation, basic features
```

**Day 2: Full Testing (EAS Build)**
```bash
eas build --profile development --platform android
# Install APK on Android phone
# Test: Videos, watermark, downloads, screen protection
```

**Day 3: iPhone Testing**
```bash
eas build --profile development --platform ios
# Install on iPhone
# Test: Same as Android
```

**Total Time: 3 days** (mostly waiting for builds)

---

## ✅ Summary

**Easiest Method**: Expo Go (5 minutes)
- Good for: UI testing, navigation, basic features
- Not good for: Screen protection, native features

**Best Method**: EAS Build (30 minutes + build time)
- Good for: Everything
- Required for: Screen protection, downloads, production testing

**My Recommendation**:
1. Use Expo Go for daily development
2. Use EAS Build once a week for full testing
3. Use Production Build before launching

---

Need help with any specific testing step? Let me know! 🚀
