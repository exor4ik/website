/**
 * 🔥 Firebase Configuration
 */

const firebaseConfig = {
  apiKey: "AIzaSyDry_UBMTfOSEriZy-HkY6Iov2KvzTkEGI",
  authDomain: "website-auth-bd057.firebaseapp.com",
  projectId: "website-auth-bd057",
  storageBucket: "website-auth-bd057.firebasestorage.app",
  messagingSenderId: "821575416626",
  appId: "1:821575416626:web:0ed81ecc4ae5e5622a752b",
  measurementId: "G-931XVK5Z5D"
};

// Инициализация
try {
  const app = firebase.initializeApp(firebaseConfig);
  window.auth = firebase.auth();
  window.db = firebase.firestore();
  console.log('✅ Firebase initialized:', app.name);
} catch (e) {
  console.error('❌ Firebase init error:', e);
}
