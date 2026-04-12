# Cloudflare Stream Integration Guide

## Overview

Cloudflare Stream is now fully integrated into your learning platform with all security features enabled. Students can watch videos with:

✅ **Download prevention** - Videos cannot be downloaded  
✅ **Right-click protection** - Context menu disabled  
✅ **Adaptive bitrate streaming** - Automatic quality adjustment  
✅ **Screenshot prevention** - Works with existing screen protection  
✅ **Analytics** - Built-in video analytics from Cloudflare  

## How to Use Cloudflare Stream

### Step 1: Upload Video to Cloudflare Stream

1. Go to your Cloudflare Dashboard
2. Navigate to **Stream** section
3. Click **Upload Video**
4. Upload your video file
5. After upload completes, copy the **Video ID** (32-character hex string)
   - Example: `a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6`

### Step 2: Add Video to Your Platform

#### For Regular Lectures:

When creating or editing a lecture:

1. **Video URL field**: Paste the Cloudflare Stream Video ID
   - Just the ID, not the full URL
   - Example: `a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6`

2. **Video Type**: Select "stream" (or leave as default - it will auto-detect)

3. Save the lecture

#### For Live Classes:

When creating or editing a live class:

1. **YouTube URL field**: Paste the Cloudflare Stream Video ID
   - Yes, the field is called "YouTube URL" but it accepts Stream IDs too
   - Just paste the Video ID: `a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6`

2. Save the live class

3. Students will see the Stream video in the live class player

### Step 3: Students Watch the Video

Students will see the video player with:
- Cloudflare's adaptive streaming
- All security features enabled
- Smooth playback on all devices
- No download or screenshot options

## Supported Video Types

Your platform now supports 3 video types:

| Type | Description | Example |
|------|-------------|---------|
| **YouTube** | YouTube videos | `https://youtube.com/watch?v=VIDEO_ID` |
| **Cloudflare Stream** | Cloudflare Stream videos | `a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6` |
| **Direct/R2** | Direct video files (MP4, etc.) | `https://cdn.example.com/video.mp4` |

The system automatically detects which type based on the URL format.

## Security Features

### Cloudflare Stream Videos Include:

1. **Download Prevention**
   - Videos are streamed, not downloaded
   - No "Save Video As" option
   - Protected against browser extensions

2. **Right-Click Protection**
   - Context menu disabled
   - Prevents "Inspect Element" access
   - Text selection disabled

3. **Screenshot Prevention** (Mobile)
   - FLAG_SECURE on Android
   - Screen capture prevention on iOS
   - Works during video playback only

4. **Adaptive Streaming**
   - Automatic quality adjustment
   - Optimized for student's connection
   - Reduces buffering

5. **Analytics**
   - View counts
   - Watch time
   - Completion rates
   - Available in Cloudflare Dashboard

## Configuration

### Environment Variables

Add to your `.env` file:

```env
# Cloudflare Stream (optional - for signed URLs)
EXPO_PUBLIC_CLOUDFLARE_ACCOUNT_ID=your_account_id_here
```

**Note**: The account ID is optional. Videos will work without it using the default Stream embed.

### For Signed URLs (Advanced)

If you want to add signed URL support for extra security:

1. Get your Cloudflare Account ID from the Stream dashboard
2. Add it to `.env` as shown above
3. Videos will use signed URLs automatically

## Testing

### Test Cloudflare Stream Integration:

1. Upload a test video to Cloudflare Stream
2. Copy the Video ID
3. Create a new lecture with the Video ID
4. Open the lecture on:
   - Web browser
   - iOS app
   - Android app
5. Verify:
   - Video plays smoothly
   - Right-click is disabled
   - Download option is not available
   - Quality adjusts automatically

## Troubleshooting

### Video Not Playing

**Issue**: Black screen or loading forever

**Solutions**:
1. Verify the Video ID is correct (32 hex characters)
2. Check video is fully processed in Cloudflare Dashboard
3. Ensure video is not set to "Private" in Stream settings
4. Check internet connection

### Video ID Format Error

**Issue**: "No video available" message

**Solution**: Ensure you're using just the Video ID, not the full URL
- ✅ Correct: `a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6`
- ❌ Wrong: `https://customer-xxx.cloudflarestream.com/a1b2c3d4.../manifest/video.m3u8`

### Quality Issues

**Issue**: Video quality is poor

**Solutions**:
1. Check original upload quality in Cloudflare Dashboard
2. Verify student's internet connection
3. Cloudflare Stream will auto-adjust quality based on bandwidth

## Migration from YouTube/R2

### Migrating Existing Videos:

1. **From YouTube**:
   - Download video from YouTube (if you have rights)
   - Upload to Cloudflare Stream
   - Update lecture with new Stream Video ID

2. **From R2/Direct URLs**:
   - Videos already uploaded to R2 can stay there
   - Or upload to Stream for better streaming performance
   - Update lecture with Stream Video ID

### Batch Migration:

For bulk migration, you can:
1. Export all lectures from database
2. Upload videos to Cloudflare Stream
3. Update database with new Video IDs
4. Use SQL UPDATE statements for batch updates

## Cost Considerations

### Cloudflare Stream Pricing:

- **Storage**: $5/month per 1,000 minutes stored
- **Delivery**: $1 per 1,000 minutes delivered
- **No bandwidth charges**
- **Unlimited viewers**

### When to Use Stream vs R2:

| Use Case | Recommended |
|----------|-------------|
| High-quality course videos | Cloudflare Stream |
| Live class recordings | Cloudflare Stream |
| Short clips/demos | R2 Direct |
| Downloadable content | R2 Direct |
| Free preview videos | YouTube or Stream |

## Best Practices

1. **Video Quality**:
   - Upload highest quality available
   - Stream will create multiple quality versions
   - Students get best quality for their connection

2. **Video Length**:
   - Optimal: 5-20 minutes per lecture
   - Maximum: No limit, but consider splitting long videos

3. **Thumbnails**:
   - Upload custom thumbnails in Cloudflare Dashboard
   - Improves student experience

4. **Captions**:
   - Add captions/subtitles in Stream dashboard
   - Improves accessibility

5. **Testing**:
   - Always test new videos before publishing
   - Check on multiple devices
   - Verify security features work

## Support

For issues with:
- **Video playback**: Check Cloudflare Stream status
- **Integration**: Check this guide and code
- **Cloudflare Stream**: Contact Cloudflare support

## Summary

✅ Cloudflare Stream is fully integrated  
✅ All security features enabled  
✅ Automatic video type detection  
✅ Works on web, iOS, and Android  
✅ No code changes needed for new videos  
✅ Just paste the Video ID when creating lectures  

Your students now have a professional, secure video streaming experience!
