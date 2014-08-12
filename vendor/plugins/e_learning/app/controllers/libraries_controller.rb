class LibrariesController < ApplicationController
  require 'constants'
  require 'pz_utils.rb'
  require 'config.rb'
  require 'charging/charging_response.rb'
  include PZ_Utils
  include ChargingResponse
  include ELearningHelper
  include ActionView::Helpers::DateHelper
  include TaggedCoursesHelper

  before_filter :require_user, :only => [:enrollment,:payment_complete,:payment_confirm,:enrollment,:enroll_and_redirect]
  before_filter :check_private_e_learning
  before_filter :set_e_learning
  before_filter :check_e_learning
  before_filter :require_context ,:only => [:course_reviews,:check_public_course_contents]


  helper_method :total_students_count
  helper_method :total_review_count
  helper_method :course_enrolled_as_teacher
  helper_method :course_image
  helper_method :price_course

  def index
      js_env :context_asset_string => @domain_root_account.try(:asset_string)
      if params[:tag_id].present?
        session[:tag_id] = params[:tag_id]
      end
  end

  def show
    if params[:id].present?
      get_course_and_price(params[:id])
      get_course_images
      @comments = @context.comments.approved.recent.limit(5).paginate(:page => params[:page], :per_page => 5)
    end
  end

  def enrollment
    get_course_and_price(params[:library_id])
    if @context and (@course_pricing.nil? || @course_pricing.price.to_i == 0)
      enroll_and_redirect
    else
      redirect_to library_payment_confirm_path(@context)
    end
  end

  def enroll_and_redirect
    @enrollment = @context.enroll_student(@current_user, :enrollment_state => 'active')
      if @enrollment
        flash[:notice] = "You are now enrolled to this course"
        redirect_to course_url(@context)
      else
        redirect_to root_url
      end
  end

  def payment_confirm
    get_course_and_price(params[:library_id])
    @grouped_payments = [[Payment.new]]
    @subscription = Subscription.find_or_create_by_account_id_and_subscribable_id_and_subscribable_type(@account.id,
                                @context.id,@context.class.name,started_on: Date.today,subscription_plan_id: 0)
    get_course_images
  end

  def payment_complete
    @payment = Payment.find(params[:payment_id]) rescue nil
    @context = Course.find(@payment.subscription.subscribable_id) rescue nil
    if (@payment.user_id == @current_user.id) && @payment.completed
      enroll_and_redirect
    else
      flash[:error] = "The payment is not completed or the payment initiator is not you."
      redirect_to library_payment_confirm_path(@context.id)
    end
  end

  def  get_course_images
    if @context.course_image and !@context.course_image.course_back_ground_image_attachment_id.nil?
      attachment = Attachment.find(@context.course_image.course_back_ground_image_attachment_id)
      if attachment && %w(available public).include?(attachment.file_state)
        @context_bg_image_url = file_download_url(attachment, { :verifier => attachment.uuid, :download => '1', :download_frd => '1' })
      end
    end
    if @context.course_image and !@context.course_image.course_image_attachment_id.nil?
      attachment = Attachment.find(@context.course_image.course_image_attachment_id)
      if attachment && %w(available public).include?(attachment.file_state)
        @context_image_url = file_download_url(attachment, { :verifier => attachment.uuid, :download => '1', :download_frd => '1' })
      end
    end
  end

  def create_user
    @context = (@account ||= @domain_root_account)
    @pseudonym = @context.pseudonyms.active.custom_find_by_unique_id(params[:pseudonym][:unique_id])
    @pseudonym = nil if @pseudonym && !['creation_pending', 'pending_approval'].include?(@pseudonym.user.workflow_state)

    manage_user_logins = @context.grants_right?(@current_user, session, :manage_user_logins)
    self_enrollment = params[:self_enrollment].present?
    allow_non_email_pseudonyms = manage_user_logins || self_enrollment && params[:pseudonym_type] == 'username'
    require_password = self_enrollment && allow_non_email_pseudonyms
    allow_password = require_password || manage_user_logins

    notify = value_to_boolean(params[:pseudonym].delete(:send_confirmation))
    notify = :self_registration unless manage_user_logins

    if params[:communication_channel]
      cc_type = params[:communication_channel][:type] || CommunicationChannel::TYPE_EMAIL
      cc_addr = params[:communication_channel][:address]
      skip_confirmation = value_to_boolean(params[:communication_channel][:skip_confirmation]) &&
          (Account.site_admin.grants_right?(@current_user, :manage_students) || Account.default.grants_right?(@current_user, :manage_students))
    else
      cc_type = CommunicationChannel::TYPE_EMAIL
      cc_addr = params[:pseudonym].delete(:path) || params[:pseudonym][:unique_id]
    end

    sis_user_id = params[:pseudonym].delete(:sis_user_id)
    sis_user_id = nil unless @context.grants_right?(@current_user, session, :manage_sis)

    @user = @pseudonym && @pseudonym.user
    @user ||= User.new
    if params[:user]
      params[:user].delete(:self_enrollment_code) unless self_enrollment
      @user.attributes = params[:user]
    end
    @user.name ||= params[:pseudonym][:unique_id]
    unless @user.registered?
      @user.workflow_state = 'registered'
    end
    @pseudonym ||= @user.pseudonyms.build(:account => @context)
    @pseudonym.account.email_pseudonyms = !allow_non_email_pseudonyms
    @pseudonym.require_password = require_password
    @pseudonym.user = @user
    params[:pseudonym][:password_confirmation] = params[:pseudonym][:password] if api_request?
    unless allow_password
      params[:pseudonym].delete(:password)
      params[:pseudonym].delete(:password_confirmation)
    end
    @pseudonym.attributes = params[:pseudonym]
    @pseudonym.sis_user_id = sis_user_id

    @pseudonym.account = @context
    @pseudonym.workflow_state = 'active'
    @cc =
        @user.communication_channels.where(:path_type => cc_type).by_path(cc_addr).first ||
            @user.communication_channels.build(:path_type => cc_type, :path => cc_addr)
    @cc.user = @user
    @cc.workflow_state = skip_confirmation ? 'active' : 'unconfirmed' unless @cc.workflow_state == 'confirmed'
    respond_to do |format|
    if @user.valid? && @pseudonym.valid?
        PseudonymSession.new(@pseudonym).save unless @pseudonym.new_record?
      @user.save!
      message_sent = false
        unless @user.pending_approval? || @user.registered?
          message_sent = true
        end
        @user.new_registration((params[:user] || {}).merge({:remote_ip  => request.remote_ip, :cookies => cookies}))
        @pseudonym.send_registration_notification!
        if params[:for_solo_teacher_enrollment].present?
          create_sub_account(@user)
        end
        format.json {render :json => @pseudonym}
    elsif @pseudonym = @context.pseudonyms.active.custom_find_by_unique_id(params[:pseudonym][:unique_id])
       if @pseudonym && @pseudonym.user && !@pseudonym.user.associated_sub_accounts.active.empty?
         @user.errors.add("You already have a solo teacher account")
         errors = {
             :errors => {
                 :pseudonym => {:unique_id => [:message => "You already have a solo teacher account"]}
             }
         }
         format.json { render :json => errors, :status => :bad_request}
       else
         PseudonymSession.new(@pseudonym).save
         if params[:for_solo_teacher_enrollment].present?
           create_sub_account(@pseudonym.user)
         end
         format.json {render :json => @pseudonym}
       end
    else
      errors = {
          :errors => {
              :user => @user.errors.as_json[:errors],
              :pseudonym => @pseudonym ? @pseudonym.errors.as_json[:errors] : {}
          }
      }
      format.json { render :json => errors, :status => :bad_request}
      end
    end
  end

  def create_sub_account(user)
    @sub_account = @context.sub_accounts.build(name: params[:sub_account_name][:account])
    @sub_account.root_account = @context.root_account
    @sub_account.settings[:Sublime_sub_account_disable] =true
    @sub_account.save
    user.flag_as_admin(@sub_account,'AccountAdmin', false)
  end

  def get_course_and_price(course_id)
    @context = Course.find(course_id)
    @course_pricing = CoursePricing.where('course_id = ? AND DATE(?) BETWEEN start_at AND end_at', @context.id, Date.today).first
  end

  def course_reviews
    @comments = @context.comments.approved.recent
    user_image=""
    respond_to do |format|
      @total_comments = []
       @comments.each do |comment|
         @user = comment.user
         @createrd_time = Time.zone.parse(comment.created_at.to_s)
         @time_in_words = (((Time.now - @createrd_time)/60)/1440).abs.to_i
         if @time_in_words == 1
           @days = @time_in_words.to_s + " day ago"
         elsif @time_in_words == 0
            @days = "today"
         else
           @days = @time_in_words.to_s + " days ago"
         end
         if service_enabled?(:avatars)
         user_image = @user.avatar_url
         end
          @course_comments_json =   api_json(comment, @current_user, session, API_USER_JSON_OPTS).tap do |json|
            json[:comments_title] = comment.title
            json[:comments] = comment.comment
            json[:commented_user] = comment.user.name
            json[:comment_created_at] = comment.created_at
            json[:user_image] = user_image
            json[:commented_day] = @days
          end
         @total_comments << @course_comments_json
       end
       @total_comments = Api.paginate(@total_comments, self, api_v1_course_reviews_url)
       format.json {render :json => @total_comments}
    end
  end

  def user_profile
    @user = User.find(params[:user_id])

  end

  def total_students_count
    @total_students_count = 0
    @teacher_enrollments = @user.teacher_enrollments.active
    @teacher_enrollments.each do |teacher_enrollment|
     course = teacher_enrollment.course
       if course
          @total_students_count += course.student_enrollments.size
       end
    end
    @total_students_count.to_i
  end

  def total_review_count
    @total_reviews_count = 0
    @enrolled_courses = @user.teacher_enrollments.active
    @enrolled_courses.each do |enrolled_course|
      @course = enrolled_course.course
      if @course
         @total_reviews_count += @course.comments.approved.size
      end
    end
    @total_reviews_count.to_i
  end

  def course_enrolled_as_teacher
    enrollments = @user.teacher_enrollments.active
    courses = []
      enrollments.each do |enrollment|
        course = enrollment.course
         if course.workflow_state == 'available' && course.settings[:make_this_course_visible_on_course_catalogue]
          courses << course
        end
      end
    courses
  end

  def course_image(course,image)

    if (image[:type] == "back_ground_image")
      if course.course_image
        back_ground_attachment_id = course.course_image.course_back_ground_image_attachment_id
        unless back_ground_attachment_id.nil?
          attachment = Attachment.find(back_ground_attachment_id)
          back_ground_image = file_download_url(attachment, { :verifier => attachment.uuid, :download => '1', :download_frd => '1' })
        end
      else
        back_ground_image = ""
      end
    else (image[:type] == "image")
    if course.course_image
      course_image_attachment_id = course.course_image.course_image_attachment_id
      unless course_image_attachment_id.nil?
        attachment = Attachment.find(course_image_attachment_id)
        back_ground_image = file_download_url(attachment, { :verifier => attachment.uuid, :download => '1', :download_frd => '1' })
      end
    else
      back_ground_image = ""
    end

    end
  end

  def check_public_course_contents
      @teacher_users =[]
      @course_images = @context.course_image
      @image = Attachment.find(@course_images.course_image_attachment_id) rescue nil
      @background_image = Attachment.find(@course_images.course_back_ground_image_attachment_id) rescue nil
      @course_desc = @context.course_description
      @short_desc =  @course_desc.short_description.html_safe if @context.course_description
      @long_description =  @course_desc.long_description.html_safe if @context.course_description
      if @domain_root_account.enable_profiles?
        @teacher_enrollments = @context.teacher_enrollments.active
        @teacher_enrollments.each do |teacher|
          if teacher.user.profile.bio && teacher.user.profile.bio != ""
            @teacher_users << {:name => teacher.user.name,:completed => true}
          else
            @teacher_users << {:name => teacher.user.name,:completed => false}
            @profile_check_passed = 0
          end
        end
      else
        @teacher_enrollments = @context.teacher_enrollments.active
        @teacher_enrollments.each do |teacher|
          if teacher.user.profile.bio && teacher.user.profile.bio != ""
            @teacher_users << {:name => teacher.user.name,:completed => true}
          else
            @teacher_users << {:name => teacher.user.name,:completed => false}
            @profile_check_passed = 0
            @account_profile_not_enabled = 0
          end
        end
      end

      @course_tags = @context.tags.count
      if @course_tags > 0
        @tags = @course_tags
      else
        @tags = 0
      end
      respond_to do |format|
        @course_json =   api_json(@context, @current_user, session, API_USER_JSON_OPTS).tap do |json|
          json[:course_name] = @course_name
          json[:course_image] = @image
          json[:course_background_image] = @background_image
          json[:long_desc] = @long_description
          json[:course_short_decription] = @short_desc
          json[:profile_check_passed] = @profile_check_passed
          json[:teacher_users] = @teacher_users
          json[:account_profile_enabled] = @account_profile_not_enabled
          json[:course_tags] = @tags
        end
        @course_json
        format.json {render :json => @course_json}
      end

  end

end
