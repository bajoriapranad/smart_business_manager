const User = require('../models/User');

// Show Registration Page
const getRegister = (req, res) => {
  res.render('auth/register', {
    title: 'Create Business Account',
    layout: false,
    formData: {},
  });
};

// Handle Registration Submission
const postRegister = async (req, res) => {
  const { name, email, phone, businessName, password, confirmPassword } = req.body;
  const formData = { name, email, phone, businessName };

  // Validation
  if (!name || !email || !phone || !businessName || !password || !confirmPassword) {
    req.flash('error_msg', 'All fields are required.');
    return res.render('auth/register', {
      title: 'Create Business Account',
      error_msg: 'All fields are required.',
      formData,
    });
  }

  if (password.length < 6) {
    return res.render('auth/register', {
      title: 'Create Business Account',
      error_msg: 'Password must be at least 6 characters long.',
      formData,
    });
  }

  if (password !== confirmPassword) {
    return res.render('auth/register', {
      title: 'Create Business Account',
      error_msg: 'Passwords do not match.',
      formData,
    });
  }

  try {
    // Check duplicate email
    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return res.render('auth/register', {
        title: 'Create Business Account',
        error_msg: 'An account with this email already exists.',
        formData,
      });
    }

    // Create user
    const newUser = new User({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      phone: phone.trim(),
      businessName: businessName.trim(),
      password,
      isDemoUser: false,
    });

    await newUser.save();

    // Establish session
    req.session.userId = newUser._id;
    req.session.user = {
      id: newUser._id,
      name: newUser.name,
      email: newUser.email,
      businessName: newUser.businessName,
    };
    req.session.businessName = newUser.businessName;
    req.session.isDemo = false;

    req.flash('success_msg', 'Account registered successfully! Welcome to your dashboard.');
    return res.redirect('/dashboard');
  } catch (error) {
    console.error('[Register Error]', error);
    return res.render('auth/register', {
      title: 'Create Business Account',
      error_msg: 'Failed to create account. Please try again.',
      formData,
    });
  }
};

// Show Login Page
const getLogin = (req, res) => {
  res.render('auth/login', {
    title: 'Login',
    layout: false,
    formData: {},
  });
};

// Handle Login Submission
const postLogin = async (req, res) => {
  const { email, password } = req.body;
  const formData = { email };

  if (!email || !password) {
    req.flash('error_msg', 'Please provide both email and password.');
    return res.render('auth/login', {
      title: 'Login',
      error_msg: 'Please provide both email and password.',
      formData,
    });
  }

  try {
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.render('auth/login', {
        title: 'Login',
        error_msg: 'Invalid email or password.',
        formData,
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.render('auth/login', {
        title: 'Login',
        error_msg: 'Invalid email or password.',
        formData,
      });
    }

    // Set Session
    req.session.userId = user._id;
    req.session.user = {
      id: user._id,
      name: user.name,
      email: user.email,
      businessName: user.businessName,
    };
    req.session.businessName = user.businessName;
    req.session.isDemo = user.isDemoUser || false;

    req.flash('success_msg', `Welcome back, ${user.name}!`);
    return res.redirect('/dashboard');
  } catch (error) {
    console.error('[Login Error]', error);
    return res.render('auth/login', {
      title: 'Login',
      error_msg: 'An error occurred during login. Please try again.',
      formData,
    });
  }
};

// Handle Logout
const logout = (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('[Logout Error]', err);
    }
    res.clearCookie('connect.sid');
    res.redirect('/auth/login?logged_out=true');
  });
};

// Enter Demo Mode Handler
const enterDemoMode = async (req, res) => {
  try {
    const demoEmail = 'demo@smartbusiness.com';
    let demoUser = await User.findOne({ email: demoEmail });

    if (!demoUser) {
      const seedDemoData = require('../seed/seed');
      await seedDemoData();
      demoUser = await User.findOne({ email: demoEmail });
    }

    // Set Demo Session
    req.session.userId = demoUser._id;
    req.session.user = {
      id: demoUser._id,
      name: demoUser.name,
      email: demoUser.email,
      businessName: demoUser.businessName,
    };
    req.session.businessName = demoUser.businessName;
    req.session.isDemo = true;

    req.flash('success_msg', 'You have entered DEMO MODE. Explore inventory, sales, and profit analytics freely!');
    return res.redirect('/dashboard');
  } catch (error) {
    console.error('[Demo Mode Error]', error);
    req.flash('error_msg', 'Could not initialize Demo Mode. Please try again.');
    return res.redirect('/');
  }
};

module.exports = {
  getRegister,
  postRegister,
  getLogin,
  postLogin,
  logout,
  enterDemoMode,
};
